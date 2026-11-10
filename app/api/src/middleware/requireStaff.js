import { Staff } from '../models/staff.js';
import { readToken, COOKIE } from '../lib/auth.js';

export function requireStaff({ roles = [], allowPinChange = false } = {}) {
  return async (req, res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Not signed in' });

    let payload;
    try {
      payload = await readToken(token);
    } catch {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    const staff = await Staff.findById(payload.sub);
    if (
      !staff ||
      !staff.active ||
      staff.tokenVersion !== payload.tv ||
      String(staff.restaurantId) !== payload.rid
    ) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    if (staff.mustChangePin && !allowPinChange) {
      return res.status(403).json({ error: 'Please change your PIN first', code: 'PIN_CHANGE_REQUIRED' });
    }
    if (roles.length && !roles.includes(staff.role)) {
      return res.status(403).json({ error: 'Your role does not allow this' });
    }

    req.staff = staff;
    next();
  };
}