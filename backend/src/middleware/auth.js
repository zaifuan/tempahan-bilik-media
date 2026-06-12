// ============================================================
// middleware/auth.js — JWT auth untuk admin
// ============================================================

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me-in-env-file';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '365d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies && req.cookies.token) || null;
  const payload = token ? verifyToken(token) : null;
  if (!payload || !payload.id) {
    return res.status(401).json({ ok: false, error: 'Sila log masuk semula.' });
  }
  req.admin = payload;
  next();
}

function requireSuperAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ ok: false, error: 'Akses ditolak — superadmin sahaja.' });
    }
    next();
  });
}

module.exports = { signToken, verifyToken, requireAdmin, requireSuperAdmin };
