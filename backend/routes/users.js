const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, Lead } = require('../models');
const { Op } = require('sequelize');
const audit = require('../services/audit');
const { authenticate, adminOnly } = require('../middleware/auth');
const {
  MODULES, MODULE_LABELS, LEVELS, LEVEL_LABELS, effectivePermissions, sanitizePermissions,
  isSuperAdmin, superAdminScope,
} = require('../services/permissions');

// Only an existing Super Admin may create, change or revoke another. Deliberately NOT delegable to
// platform-level admins — a Signage PMO must not be able to mint cross-platform access.
function superAdminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (isSuperAdmin(req.user)) return next();
  return res.status(403).json({ message: 'Only a Super Admin can manage Super Admin access.' });
}

const COLOR_ROTATION = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-orange-500', 'bg-teal-500', 'bg-rose-500', 'bg-indigo-500'];
const DEFAULT_BD_PASSWORD = '123456'; // system default — the BD is expected to change it after first login

// The "Unassigned" placeholder BD holds leads orphaned when a BD is deleted. One per business unit,
// created on demand. It has no password (cannot log in) and is inactive, so it stays out of the login
// list and BD dropdowns while still showing as the owner on the transferred leads.
async function getOrCreateUnassignedBd(businessUnit) {
  let u = await User.findOne({ where: { name: 'Unassigned', role: 'bd', business_unit: businessUnit } });
  if (!u) {
    u = await User.create({
      name: 'Unassigned', email: null, mobile: null, password_hash: null, role: 'bd',
      business_unit: businessUnit, initials: 'UN', color: 'bg-slate-500', active: false, sort_order: 999,
    });
  }
  return u;
}

// GET /api/users — list users. Used by the login page to show BD cards.
// Query params: role, business_unit
// Public-ish read (no auth) so the login screen can render BDs.
router.get('/', async (req, res) => {
  try {
    const where = { active: true };
    if (req.query.role)          where.role = req.query.role;
    if (req.query.business_unit) where.business_unit = req.query.business_unit;

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password_hash', 'email'] }, // never leak these to unauthenticated callers
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/users/manage — admin/PMO only. Full user records (BD + PMO) for a business unit, used by
// the Settings page to list, edit and manage the team. Unlike the public GET /, this includes email
// and mobile because the caller is an authenticated admin.
router.get('/manage', authenticate, adminOnly, async (req, res) => {
  try {
    // Include inactive (disabled) users too, so the Settings page can re-enable them.
    const where = { role: ['super_admin', 'business_admin', 'pmo', 'bd', 'forecast'] };
    // Non-super-admins only ever see their own business's users. super_admin may switch business via
    // the business_unit query param (defaulting to their own).
    // A cross-platform Super Admin may inspect any platform's user list via ?business_unit=;
    // everyone else is pinned to their own.
    where.business_unit = isSuperAdmin(req.user) ? (req.query.business_unit || req.user.business_unit) : req.user.business_unit;
    const users = await User.findAll({
      where,
      attributes: { exclude: ['password_hash'] },
      order: [['role', 'ASC'], ['sort_order', 'ASC'], ['name', 'ASC']],
    });
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Validate the add/edit payload shared by POST and PUT. Returns an error string or null.
// Roles that can be created/edited through the UI (super_admin is set up out-of-band — one for now).
const VALID_ROLES = ['business_admin', 'pmo', 'bd', 'forecast'];
function validateUserPayload({ name, email, mobile, role }) {
  if (!name || !name.trim())   return 'Name is required';
  if (!email || !email.trim()) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email';
  if (!mobile || !mobile.trim()) return 'Mobile is required';
  if (!/^\d{10}$/.test(mobile.trim())) return 'Mobile must be exactly 10 digits';
  if (!VALID_ROLES.includes(role)) return 'Role must be Business Admin, PMO, BD or Forecast';
  return null;
}

// Role hierarchy — which roles each admin-tier actor may create/edit/delete/manage.
//   super_admin    → Business Admin, PMO, BD, Forecast (in ANY business)
//   business_admin → PMO, BD, Forecast (their business)
//   pmo            → BD only (their business)
const ASSIGNABLE_ROLES = {
  super_admin:    ['business_admin', 'pmo', 'bd', 'forecast'],
  business_admin: ['pmo', 'bd', 'forecast'],
  pmo:            ['bd'],
};
const canManageRole = (actorRole, targetRole) => (ASSIGNABLE_ROLES[actorRole] || []).includes(targetRole);

// The business a created user lands in: super_admin may target any business; everyone else is confined
// to their own.
const resolveBusinessUnit = (actor, requestedBu) => (isSuperAdmin(actor) ? (requestedBu || actor.business_unit) : actor.business_unit);

// Can `actor` manage the existing `target` user? Must be allowed by the role hierarchy AND (unless the
// actor is super_admin) within the actor's own business.
function canActOn(actor, target) {
  if (!canManageRole(actor.role, target.role)) return false;
  if (!isSuperAdmin(actor) && target.business_unit !== actor.business_unit) return false;
  return true;
}

// POST /api/users — admin/PMO only. Add a user. Body: { name, email, mobile, role, business_unit }.
// role is 'pmo' (main admin) or 'bd' (sales user). All fields are mandatory.
router.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, email, mobile, role } = req.body;
    const business_unit = resolveBusinessUnit(req.user, req.body.business_unit);
    if (!business_unit) return res.status(400).json({ message: 'business_unit is required' });
    const invalid = validateUserPayload({ name, email, mobile, role });
    if (invalid) return res.status(400).json({ message: invalid });
    if (!canManageRole(req.user.role, role)) return res.status(403).json({ message: `You are not allowed to create a ${role} account.` });

    // Email is unique per business unit (see migration 002).
    const clash = await User.findOne({ where: { email: email.trim(), business_unit } });
    if (clash) return res.status(409).json({ message: `A ${business_unit} user with email ${email.trim()} already exists` });

    const count = await User.count({ where: { business_unit, role } });
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const color = COLOR_ROTATION[count % COLOR_ROTATION.length];
    const maxOrder = (await User.max('sort_order', { where: { business_unit, role } })) || 0;
    const password_hash = await bcrypt.hash(DEFAULT_BD_PASSWORD, 10);

    // Module access is chosen in the same dialog as the account. When the caller supplies a map we
    // store it verbatim; otherwise the role-derived default applies (services/permissions.js), so an
    // older client that posts no permissions still creates a working account.
    let module_permissions = null;
    if (req.body.permissions) {
      const { error, value } = sanitizePermissions(req.body.permissions);
      if (error) return res.status(400).json({ message: error });
      module_permissions = JSON.stringify(value);
    }

    const created = await User.create({
      name: name.trim(), email: email.trim(), mobile: mobile.trim(), business_unit, role,
      initials, color, sort_order: maxOrder + 1, active: true, password_hash, module_permissions,
    });
    const safe = created.toJSON();
    delete safe.password_hash;
    return res.status(201).json({ ...safe, defaultPassword: DEFAULT_BD_PASSWORD });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id — admin/PMO only. Edit a user's name, email, mobile and role.
// Does not change the password (use reset-password for that).
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, email, mobile, role } = req.body;
    const invalid = validateUserPayload({ name, email, mobile, role });
    if (invalid) return res.status(400).json({ message: invalid });

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const isSelf = String(user.id) === String(req.user.id);
    // Anyone can edit their own profile (but not their own role, below); managing others follows the
    // role hierarchy.
    if (!isSelf && !canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });
    if (!isSelf && role !== user.role && !canManageRole(req.user.role, role)) return res.status(403).json({ message: `You are not allowed to assign the ${role} role.` });

    // A user cannot change their own role.
    if (isSelf && role !== user.role) {
      return res.status(400).json({ message: 'You cannot change your own role' });
    }

    // Email stays unique per business unit — reject a clash with a *different* user.
    const clash = await User.findOne({ where: { email: email.trim(), business_unit: user.business_unit } });
    if (clash && clash.id !== user.id) {
      return res.status(409).json({ message: `Another ${user.business_unit} user already uses ${email.trim()}` });
    }

    // Persist via an explicit UPDATE so the write does not depend on the in-memory instance's
    // dirty-tracking.
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    await User.update(
      { name: name.trim(), email: email.trim(), mobile: mobile.trim(), role, initials },
      { where: { id: user.id } },
    );

    const updated = await User.findByPk(user.id);
    const safe = updated.toJSON();
    delete safe.password_hash;
    return res.json(safe);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id/reset-password — admin/PMO only. Resets a BD's forgotten
// password to a value PMO chooses. Body: { newPassword }
router.put('/:id/reset-password', authenticate, adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role !== 'bd') return res.status(400).json({ message: 'Only BD accounts can be reset here' });
    if (!canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });

    user.password_hash = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ message: `Password reset for ${user.name}` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id/active — admin/PMO only. Enable or disable (soft) a BD or PMO. A disabled user
// keeps all their data and leads but can no longer log in or appear in the login list. Body:
// { active: true|false }. You cannot disable your own account.
router.put('/:id/active', authenticate, adminOnly, async (req, res) => {
  try {
    const active = !!req.body.active;
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });
    if (!active && String(user.id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot disable your own account' });
    }

    // Persist via an explicit UPDATE rather than instance .save() so the write does not depend on
    // Sequelize's dirty-tracking of the in-memory instance.
    await User.update({ active }, { where: { id: user.id } });
    return res.json({ message: `${active ? 'Enabled' : 'Disabled'} ${user.name}`, active });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id/forecast-access — admin/PMO only. Grant or revoke a user's access to the
// (login-gated) Forecast dashboard. Body: { forecast_access: true|false }.
router.put('/:id/forecast-access', authenticate, adminOnly, async (req, res) => {
  try {
    const forecast_access = !!req.body.forecast_access;
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });
    await User.update({ forecast_access }, { where: { id: user.id } });
    return res.json({ message: `${forecast_access ? 'Granted' : 'Revoked'} Forecast access for ${user.name}`, forecast_access });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/users/:id/permissions — the user's effective per-module map, for the permission editor.
// Returns the resolved levels (role-derived defaults filled in) rather than the raw column, so the
// editor always opens showing what is actually in force.
router.get('/:id/permissions', authenticate, adminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });
    return res.json({
      id: user.id, name: user.name, role: user.role, business_unit: user.business_unit,
      permissions: effectivePermissions(user),
      modules: MODULES, levels: LEVELS,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id/permissions — body { permissions: { leads, dashboard, forecast, reports } }
//
// Restricted to the same admin tier that already manages users (adminOnly + canActOn), so this adds
// no new privilege. Settings is deliberately not settable here: it stays role-gated.
//
// Note these levels are a CEILING, not a grant — the role and business_unit checks still run on
// every request, so raising someone to Full Access cannot let them past a limit their role imposes
// (a BD still sees only their own leads and still cannot delete).
router.put('/:id/permissions', authenticate, adminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });

    const { error, value } = sanitizePermissions(req.body.permissions || {});
    if (error) return res.status(400).json({ message: error });

    const before = effectivePermissions(user);
    await User.update({ module_permissions: JSON.stringify(value) }, { where: { id: user.id } });

    const changed = MODULES.filter(m => before[m] !== value[m])
      .map(m => `${MODULE_LABELS[m]}: ${LEVEL_LABELS[before[m]]} → ${LEVEL_LABELS[value[m]]}`);

    // One audit entry per module changed, so the feed reads "Leads: Edit → Full Access".
    await audit.recordDiff(
      { actor: req.user, entityType: 'permissions', entityId: user.id, subject: user.name,
        businessUnit: user.business_unit, action: 'permission_update' },
      MODULES.map(m => ({ field: `${MODULE_LABELS[m]} access`, from: LEVEL_LABELS[before[m]], to: LEVEL_LABELS[value[m]] })),
    );
    return res.json({
      message: changed.length ? `Updated ${user.name}: ${changed.join(', ')}` : `No permission changes for ${user.name}`,
      permissions: value,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// Cross-platform Super Admins — a dedicated section, deliberately NOT part of any single
// platform's user list. Managed only by an existing Super Admin.
// --------------------------------------------------------------------------

// GET /api/users/super-admins — everyone currently holding the grant, across every platform.
router.get('/super-admins', authenticate, superAdminOnly, async (req, res) => {
  try {
    const rows = await User.findAll({
      where: { super_admin_scope: ['read', 'write'] },
      attributes: { exclude: ['password_hash'] },
      order: [['name', 'ASC']],
    });
    // Candidates to promote: any active account with an email (Super Admins sign in by email).
    const candidates = await User.findAll({
      where: { active: true, email: { [Op.ne]: null }, super_admin_scope: null },
      attributes: ['id', 'name', 'email', 'role', 'business_unit'],
      order: [['name', 'ASC']],
    });
    return res.json({
      superAdmins: rows.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        business_unit: u.business_unit, active: u.active, scope: u.super_admin_scope,
      })),
      candidates,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id/super-admin — body { scope: 'read' | 'write' | null }
//
// The grant is ADDITIVE: it never touches the user's role or business_unit, so their existing
// platform-specific role keeps working exactly as before. Revoking (null) likewise leaves the
// platform role intact. Every change is written to the audit trail below.
router.put('/:id/super-admin', authenticate, superAdminOnly, async (req, res) => {
  try {
    const raw = req.body.scope;
    const scope = (raw === null || raw === '' || raw === undefined) ? null : raw;
    if (scope !== null && scope !== 'read' && scope !== 'write') {
      return res.status(400).json({ message: "scope must be 'read', 'write', or null to revoke" });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // You cannot change your own grant. Revoking it would immediately remove your ability to undo
    // that, and downgrading yourself to Read-only would do the same — so another Super Admin has to
    // make the change. Mirrors how the app already blocks self-Disable and self-Delete.
    if (String(user.id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot change your own Super Admin access — ask another Super Admin to do it.' });
    }

    if (scope && !user.email) {
      return res.status(400).json({ message: 'A Super Admin signs in by email, so this account needs an email address first.' });
    }
    // Guard against removing the last write-capable Super Admin and locking everyone out.
    const before = superAdminScope(user);
    if (before === 'write' && scope !== 'write') {
      const others = await User.count({ where: { super_admin_scope: 'write', active: true, id: { [Op.ne]: user.id } } });
      if (others === 0) {
        return res.status(400).json({ message: 'This is the last Read+Write Super Admin — promote another one before changing this.' });
      }
    }

    await User.update({ super_admin_scope: scope }, { where: { id: user.id } });

    // Audit: cross-platform, so business_unit stays null — those entries are admin-only in the feed.
    const LABEL = { write: 'Read+Write', read: 'Read-only', null: 'None' };
    await audit.record({
      actor: req.user, entityType: 'permissions', entityId: user.id, subject: user.name,
      businessUnit: null, action: 'super_admin_change', field: 'Super Admin access',
      from: LABEL[before] || 'None', to: LABEL[scope] || 'None',
      note: 'Cross-platform access',
    });

    const label = scope === 'write' ? 'Read+Write' : scope === 'read' ? 'Read-only' : 'revoked';
    return res.json({
      message: scope ? `${user.name} is now a Super Admin (${label}).` : `Super Admin access revoked for ${user.name}.`,
      scope,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});



// DELETE /api/users/:id — admin/PMO only. PERMANENTLY delete a BD or PMO. Blocked for your own
// account, and blocked when the user still owns leads (owner_id is a RESTRICT foreign key) — disable
// them instead, or reassign their leads first.
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!canActOn(req.user, user)) return res.status(403).json({ message: 'You are not allowed to manage this user.' });
    if (String(user.id) === String(req.user.id)) return res.status(400).json({ message: 'You cannot delete your own account' });

    // Reassign any leads this user owns before deleting (owner_id is a RESTRICT FK). The PMO chooses
    // the target: 'unassigned' routes them to the system "Unassigned" BD (auto-created per business
    // unit); a specific BD/PMO id transfers them to that person.
    const leadCount = await Lead.count({ where: { owner_id: user.id } });
    const reassignTo = req.body && req.body.reassign_to;
    let target = null;
    if (leadCount > 0) {
      if (!reassignTo) {
        return res.status(409).json({ message: `${user.name} owns ${leadCount} lead(s). Choose who to transfer them to.`, requiresReassign: true, leadCount });
      }
      if (reassignTo === 'unassigned') {
        target = await getOrCreateUnassignedBd(user.business_unit);
      } else {
        target = await User.findByPk(reassignTo);
        if (!target || target.business_unit !== user.business_unit || !['bd', 'pmo'].includes(target.role)) {
          return res.status(400).json({ message: 'Invalid transfer target.' });
        }
        if (String(target.id) === String(user.id)) return res.status(400).json({ message: 'Cannot transfer leads to the account being deleted.' });
      }
    }

    if (target) await Lead.update({ owner_id: target.id }, { where: { owner_id: user.id } });
    await user.destroy();
    return res.json({ message: `Permanently deleted ${user.name}${target ? ` and transferred ${leadCount} lead(s) to ${target.name}` : ''}` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
