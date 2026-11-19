import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import sharp from 'sharp';
import { config } from '../config.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const WIDTHS = [400, 1200]; // menu thumbnail, item sheet
const MAX_PIXELS = 40_000_000; // ~8000×5000; stops a "decompression bomb" from eating the API's memory

export class MediaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let s3;
const client = () => (s3 ??= new S3Client({ region: config.AWS_REGION }));
export const photosEnabled = () => Boolean(config.MEDIA_BUCKET);

// A one-time permission for the browser to upload one file straight to S3: right type, at most 5 MB, 5 minutes
export async function createUpload({ restaurantId, itemId, contentType }) {
  const key = `uploads/${restaurantId}/${itemId}/${randomUUID()}`;
  const { url, fields } = await createPresignedPost(client(), {
    Bucket: config.MEDIA_BUCKET,
    Key: key,
    Expires: 300,
    Conditions: [
      ['content-length-range', 1, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
  });
  return { url, fields, key };
}

// The real format, from the file's first bytes. The declared type and file name can't be trusted.
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// WebP copies at standard widths. Re-encoding drops all metadata, including GPS location from phone cameras.
export async function processImage(buf) {
  if (!sniffImage(buf)) throw new MediaError('NOT_AN_IMAGE', "That file isn't a JPEG, PNG or WebP image.");
  try {
    const image = sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate(); // apply the camera's orientation
    const versions = await Promise.all(
      WIDTHS.map(async (width) => {
        const { data, info } = await image
          .clone()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        return { width: info.width, height: info.height, data };
      })
    );
    // A small original gives the same width twice; keep one
    return versions.filter((v, i) => versions.findIndex((x) => x.width === v.width) === i);
  } catch {
    throw new MediaError('UNREADABLE', "Couldn't read that image. Try another photo.");
  }
}

export async function finishUpload({ key, restaurantId, itemId }) {
  // Only accept the upload slot this item was given
  if (!key.startsWith(`uploads/${restaurantId}/${itemId}/`) || key.includes('..')) {
    throw new MediaError('BAD_KEY', 'That upload does not belong to this item.');
  }

  let obj;
  try {
    obj = await client().send(new GetObjectCommand({ Bucket: config.MEDIA_BUCKET, Key: key }));
  } catch (err) {
    if (err.name === 'NoSuchKey') throw new MediaError('UPLOAD_NOT_FOUND', 'The upload expired or never finished. Please try again.');
    throw err;
  }
  if (obj.ContentLength > MAX_UPLOAD_BYTES) throw new MediaError('TOO_LARGE', 'The photo is larger than 5 MB.');

  const original = Buffer.from(await obj.Body.transformToByteArray());
  const versions = await processImage(original);
  const hash = createHash('sha256').update(original).digest('hex').slice(0, 16); // new photo = new file names, so caches never serve an old one

  const variants = await Promise.all(
    versions.map(async (v) => {
      const outKey = `media/${restaurantId}/${itemId}/${hash}-${v.width}.webp`;
      await client().send(
        new PutObjectCommand({
          Bucket: config.MEDIA_BUCKET,
          Key: outKey,
          Body: v.data,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );
      return { key: outKey, width: v.width, height: v.height };
    })
  );

  await deleteKeys([key]);
  return variants.sort((a, b) => a.width - b.width);
}

export async function deleteKeys(keys) {
  if (!keys.length || !photosEnabled()) return;
  await client().send(
    new DeleteObjectsCommand({ Bucket: config.MEDIA_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })) } })
  );
}