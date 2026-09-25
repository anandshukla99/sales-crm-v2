const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const {
  effectivePermissions, PERMISSION_MANAGER_ROLES, isSuperAdmin, superAdminScope,
} = require('../services/permissions');

// The user object every authenticated response returns. Must match GET /auth/me exactly: the
// client gates its entire navigation on `permissions`, so a login response that omits them makes
// the app think the user has no modules until the next background refresh.
function authUserPayload(user) {
  const safe = user.toJSON();
  delete safe.password_hash;
  delete safe.module_permissions;          // the resolved map below is the contract
  safe.permissions = effectivePermissions(user);
  safe.can_manage_permissions = PERMISSION_MANAGER_ROLES.includes(user.role) || isSuperAdmin(user);
  // Cross-platform Super Admin grant (migration 021) — additive to `role`, so it is reported
  // separately rather than folded into it.
  safe.super_admin_scope = superAdminScope(user);
  safe.is_super_admin = isSuperAdmin(user);
  safe.super_admin_read_only = user.super_admin_scope === 'read';
  return safe;
}


const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
);

// POST /api/auth/login — admin/PMO login with email + password.
router.post('/login', async (req, res) => {
  try {
    const { email, password, business_unit } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    // Scope the lookup to the chosen business unit when supplied. The same email may hold a separate
    // account per business unit (see migration 002), so matching on email alone would return whichever
    // row comes first. With business_unit set, each admin signs into their own business unit's account.
    const where = { email };
    if (business_unit) where.business_unit = business_unit;
    const user = await User.findOne({ where });
    if (!user)                 return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.active)          return res.status(403).json({ message: 'User is inactive' });
    // super_admin/business_admin/pmo sign into the full app; a 'forecast' account signs in to the
    // Forecast dashboard only. (BDs use /auth/bd-login.)
    if (!['super_admin', 'business_admin', 'pmo', 'forecast'].includes(user.role)) return res.status(403).json({ message: 'This account cannot sign in here' });
    if (!user.password_hash)   return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = signToken(user);
    return res.json({ token, user: authUserPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/bd-login — BD login with { userId, password }.
// Each BD has their own bcrypt-hashed password (set by PMO on creation,
// changeable by the BD themselves via /auth/change-password afterward).
router.post('/bd-login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ message: 'BD id and password required' });

    const user = await User.findByPk(userId);
    if (!user)                return res.status(404).json({ message: 'BD not found' });
    if (!user.active)         return res.status(403).json({ message: 'BD is inactive' });
    if (user.role !== 'bd')   return res.status(403).json({ message: 'Not a BD account' });
    if (!user.password_hash)  return res.status(500).json({ message: 'This BD has no password set. Ask PMO to reset it.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Incorrect password' });

    const token = signToken(user);
    return res.json({ token, user: authUserPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me — the current authenticated user, plus their effective per-module access.
// The frontend re-polls this (on focus and on an interval) so a permission change an admin makes
// applies to the affected user without them re-logging in. `permissions` is always the resolved
// map, never the raw column, so the client never has to know about defaults.
router.get('/me', authenticate, async (req, res) => {
  try {
    return res.json(authUserPayload(req.user));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/change-password — any authenticated user (admin, PMO, or BD)
// changes their own password.
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password too short (min 6)' });

    const user = await User.findByPk(req.user.id);
    if (!user || !user.password_hash) return res.status(404).json({ message: 'User not found' });

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Current password is wrong' });

    user.password_hash = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ message: 'Password updated' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
