import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(String(pin), salt, 32);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}