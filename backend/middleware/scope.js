// Data isolation, enforced at the API layer (not just in the UI).
// Every user belongs to exactly ONE business unit, so ALL roles are scoped to their own
// business_unit: a signage PMO never sees another business unit's leads and vice-versa. On top of
// that, a BD only ever sees rows they own.
const { isSuperAdmin } = require('../services/permissions');

function leadScopeWhere(user, extra = {}) {
  // A cross-platform Super Admin (migration 021) is deliberately NOT confined to one business
  // unit — that is the whole point of the grant. Omitting the filter rather than listing the
  // platforms means any platform added later is included automatically.
  if (isSuperAdmin(user)) return { ...extra };
  const where = { ...extra, business_unit: user.business_unit };
  if (user.role === 'bd') where.owner_id = user.id;
  return where;
}

module.exports = { leadScopeWhere };
