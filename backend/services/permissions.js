// ---------------------------------------------------------------------------
// Per-module access levels (RBAC) — the single source of truth for what the four
// general modules are, what the four levels mean, and how a user's stored map is
// resolved into an effective level.
//
// This is a SECOND dimension alongside the existing role and business_unit model,
// not a replacement. Both are enforced, and both must pass:
//
//   role         — what this kind of user may ever do (BDs only touch their own
//                  leads, only the admin tier deletes, Settings is role-gated…)
//   module level — what this particular user may do in this particular module
//   business_unit— which platform's rows they can see at all
//
// Because they compose by AND, a module level can only ever narrow a role. That is
// what makes rollout safe: seeding everyone at their current effective access
// (migration 020) is guaranteed not to hand anyone new powers.
// ---------------------------------------------------------------------------

// The four general modules. Settings is intentionally absent — it is role-gated to
// the admin tier and cannot be granted to anyone else at any level.
const MODULES = ['leads', 'dashboard', 'forecast', 'reports'];

const MODULE_LABELS = {
  leads: 'Leads',
  dashboard: 'Dashboard',
  forecast: 'Forecast',
  reports: 'Reports',
};

// Ordered weakest → strongest. RANK drives every comparison.
const LEVELS = ['none', 'read', 'edit', 'full'];
const RANK = { none: 0, read: 1, edit: 2, full: 3 };

const LEVEL_LABELS = {
  none: 'No Access',
  read: 'Read-only',
  edit: 'Edit',
  full: 'Full Access',
};

// Roles permitted to view and change other users' permissions. Mirrors who already
// manages users (adminOnly on /api/users), so this introduces no new privilege.
const PERMISSION_MANAGER_ROLES = ['super_admin', 'business_admin', 'pmo'];

// --- Cross-platform Super Admin (migration 021) ----------------------------------------------
// A GRANT held alongside `role`, not a role of its own, so it can be additive. It spans every
// platform automatically — nothing here enumerates business units, so a platform added later is
// covered with no reconfiguration.
//   'write' -> unrestricted: Full Access to every module, on every platform
//   'read'  -> Read-only everywhere: sees all platforms, changes nothing
const isSuperAdmin      = (user) => user?.super_admin_scope === 'read' || user?.super_admin_scope === 'write';
const superAdminScope   = (user) => (isSuperAdmin(user) ? user.super_admin_scope : null);
const isSuperAdminWrite = (user) => user?.super_admin_scope === 'write';
const isSuperAdminRead  = (user) => user?.super_admin_scope === 'read';

// Default map for a user with no stored permissions — derived from the legacy model so
// behaviour is identical for any account the migration hasn't touched (e.g. one created
// by an older code path). Mirrors the seed in migration 020.
function defaultPermissionsFor(user) {
  const role = user?.role;
  if (PERMISSION_MANAGER_ROLES.includes(role)) {
    return { leads: 'full', dashboard: 'full', forecast: 'full', reports: 'full' };
  }
  if (role === 'forecast') {
    // Forecast-only account: the dashboard plus the Sent-to-SCM tick it already had.
    return { leads: 'none', dashboard: 'none', forecast: 'edit', reports: 'none' };
  }
  return {
    leads: 'full',                                       // BDs create their own leads today
    dashboard: 'read',
    forecast: user?.forecast_access ? 'edit' : 'none',
    reports: 'none',
  };
}

// Parse the stored JSON defensively: corrupt or legacy values fall back to the role
// default rather than locking someone out or silently opening a module.
function storedPermissions(user) {
  const raw = user?.module_permissions;
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// The user's effective level for one module. Unknown module, unknown level, or a module
// absent from the stored map → 'none' (a new module is denied until granted).
function levelFor(user, module) {
  if (!MODULES.includes(module)) return 'none';
  // A Super Admin's level is fixed by their mode, not by a per-module map: Read+Write is
  // unrestricted by design, and Read-only is read everywhere. Per-module restriction of a Super
  // Admin is deliberately not possible.
  if (isSuperAdminWrite(user)) return 'full';
  if (isSuperAdminRead(user)) return 'read';
  const stored = storedPermissions(user);
  const map = stored || defaultPermissionsFor(user);
  const value = map[module];
  return LEVELS.includes(value) ? value : 'none';
}

// Does this user meet at least `minLevel` in `module`?
function hasLevel(user, module, minLevel) {
  return RANK[levelFor(user, module)] >= (RANK[minLevel] ?? 99);
}

// Does the user meet `minLevel` in ANY of these modules? Used where one endpoint backs
// several modules — GET /api/leads feeds the Leads list, the Dashboard and Reports alike,
// so a Dashboard-only user must still be able to read lead rows.
function hasLevelInAny(user, modules, minLevel) {
  return modules.some(m => hasLevel(user, m, minLevel));
}

// The full effective map, for /api/auth/me and the admin editor.
function effectivePermissions(user) {
  const out = {};
  for (const m of MODULES) out[m] = levelFor(user, m);
  return out;
}

// Validate and normalise a map coming from the permission editor. Unknown modules are
// dropped, unknown levels rejected, missing modules default to 'none'.
function sanitizePermissions(input) {
  const out = {};
  for (const m of MODULES) {
    const v = input?.[m];
    if (v === undefined || v === null || v === '') { out[m] = 'none'; continue; }
    if (!LEVELS.includes(v)) return { error: `Invalid level "${v}" for module "${m}"` };
    out[m] = v;
  }
  return { value: out };
}

module.exports = {
  MODULES, MODULE_LABELS, LEVELS, LEVEL_LABELS, RANK, PERMISSION_MANAGER_ROLES,
  isSuperAdmin, superAdminScope, isSuperAdminWrite, isSuperAdminRead,
  defaultPermissionsFor, levelFor, hasLevel, hasLevelInAny, effectivePermissions, sanitizePermissions,
};
