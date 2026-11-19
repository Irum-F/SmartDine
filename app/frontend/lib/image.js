const MAX_SIDE = 2000;

// Phone photos are often 4–12 MB. Redrawing on a canvas makes them ~0.5 MB JPEGs, respects the
// camera's rotation, and drops hidden metadata before anything leaves the device.
export async function prepareImage(file) {
  if (file.type && !/^image\//.test(file.type)) throw new Error('Choose a photo (JPEG, PNG or WebP).');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't read that photo. Try a JPEG or PNG.");
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs would otherwise turn black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error("Couldn't prepare that photo. Try another one.");
  return blob;
}