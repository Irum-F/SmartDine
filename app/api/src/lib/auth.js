import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const key = new TextEncoder().encode(config.JWT_SECRET);

export const COOKIE = 'sd_staff';

export const cookieOptions = {
  httpOnly: true,                                 // page JavaScript can't read it
  secure: config.NODE_ENV === 'production',       // HTTPS only in production
  sameSite: 'strict',
  maxAge: 12 * 60 * 60 * 1000,                    // one shift
  path: '/',
};

export function issueToken(staff) {
  return new SignJWT({ rid: String(staff.restaurantId), role: staff.role, tv: staff.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(staff._id))
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key);
}

export async function readToken(token) {
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
  return payload;
}