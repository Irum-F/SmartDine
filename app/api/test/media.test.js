import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { setup, teardown, resetDb, seedRestaurant, staffAgent } from './helpers.js';

// Imported after helpers.js has set the test environment
const { processImage, sniffImage } = await import('../src/services/media.js');

let app;
before(async () => { app = await setup(); });
after(teardown);
beforeEach(resetDb);

const solid = (width, height) => sharp({ create: { width, height, channels: 3, background: '#c9a24d' } });

test('only real JPEG, PNG or WebP files are accepted', async () => {
  assert.equal(sniffImage(await solid(10, 10).png().toBuffer()), 'png');
  assert.equal(sniffImage(await solid(10, 10).jpeg().toBuffer()), 'jpeg');
  const fake = Buffer.from('<script>alert("not a photo")</script>');
  assert.equal(sniffImage(fake), null);
  await assert.rejects(processImage(fake), { code: 'NOT_AN_IMAGE' });
});

test('photos are resized to WebP and lose their camera metadata', async () => {
  const photo = await solid(2400, 1600).jpeg().withExif({ IFD0: { Copyright: 'taken at home' } }).toBuffer();
  assert.ok((await sharp(photo).metadata()).exif, 'the original carries metadata');

  const out = await processImage(photo);
  assert.deepEqual(out.map((v) => v.width), [400, 1200]);
  assert.equal(out[1].height, 800);
  for (const v of out) {
    const meta = await sharp(v.data).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined);
  }
});

test('small photos are never enlarged', async () => {
  const out = await processImage(await solid(300, 200).png().toBuffer());
  assert.deepEqual(out.map((v) => v.width), [300]);
});

test('photo uploads say clearly when storage is not set up', async () => {
  const fx = await seedRestaurant();
  const manager = await staffAgent(app, 'bistro', 'mona');
  const res = await manager.post(`/api/admin/menu/${fx.soda._id}/photo-upload`).send({ contentType: 'image/jpeg' });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'PHOTOS_DISABLED');
});