import { AuditLog } from '../models/auditLog.js';

// Records who changed what. A failed log write must never block the change itself.
export async function audit(req, action, summary, details) {
  try {
    await AuditLog.create({
      restaurantId: req.staff.restaurantId,
      staffId: req.staff._id,
      staffName: `${req.staff.name} (${req.staff.role})`,
      action,
      summary,
      details,
    });
  } catch (err) {
    req.log.error({ err, action }, 'Audit write failed');
  }
}