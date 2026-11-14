import { readToken } from './auth.js';
import { Staff } from '../models/staff.js';

// Returns the staff member if the token is valid AND still current, otherwise null
export async function staffFromToken(token) {
  if (!token) return null;
  const payload = await readToken(token).catch(() => null);
  if (!payload) return null;
  const staff = await Staff.findById(payload.sub);
  if (!staff || !staff.active || staff.tokenVersion !== payload.tv) return null;
  return { staff, exp: payload.exp };
}