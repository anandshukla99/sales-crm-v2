import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getMe } from '../services/api';
import { meets } from '../utils/permissions';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Was this session started via the "Admin Login" button (global Admin Console) rather than a
  // business sign-in? The same super_admin account is also the Signage admin, so we distinguish the
  // two experiences by HOW the user logged in, not by their role. Persisted so it survives reloads.
  const [consoleMode, setConsoleMode] = useState(() => localStorage.getItem('salescrm_console') === '1');

  // On mount, if a token exists, hydrate the user via /api/auth/me.
  useEffect(() => {
    const token = localStorage.getItem('salescrm_token');
    if (!token) { setLoading(false); return; }
    getMe()
      .then(setUser)
      .catch(() => { localStorage.removeItem('salescrm_token'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // Per-module permissions must take effect WITHOUT the user re-logging in. They live on the user
  // row (never in the JWT), so the server already honours a change on the very next request; this
  // re-poll is what makes the UI follow. Refreshing on window focus covers the realistic case —
  // an admin changes access and tells the person — and the interval catches an idle open tab.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const refresh = () => {
      if (!localStorage.getItem('salescrm_token')) return;
      getMe()
        .then(fresh => { if (!cancelled) setUser(fresh); })
        .catch(() => { /* transient failure — keep the current view, next poll retries */ });
    };
    // Safety net: if whatever set this user didn't carry a permission map, fetch one straight away
    // rather than leaving the app to believe they have no modules until the next poll.
    if (!user.permissions) refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(refresh, 60000);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); clearInterval(timer); };
    // Re-arm only when the identity changes, not on every permission refresh.
  }, [user?.id]);

  const login = useCallback((token, u) => {
    localStorage.setItem('salescrm_token', token);
    // LoginPage sets/clears salescrm_console just before this call to mark the session type.
    setConsoleMode(localStorage.getItem('salescrm_console') === '1');
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('salescrm_token');
    localStorage.removeItem('salescrm_console');
    setConsoleMode(false);
    setUser(null);
  }, []);

  // Permission predicates
  const isAuthenticated = !!user;
  // Admin tier — reaches Settings, Reports, bulk actions.
  const ADMIN_TIER      = ['super_admin', 'business_admin', 'pmo'];
  const isAdmin         = user && ADMIN_TIER.includes(user.role);
  // --- Cross-platform Super Admin (migration 021) -----------------------------------------
  // A GRANT held alongside the platform role, so it is additive: a Signage PMO can also be a
  // Super Admin without losing their platform role. Spans every platform automatically.
  const superAdminScope   = user?.super_admin_scope || null;      // null | 'read' | 'write'
  const isCrossPlatform   = !!user?.is_super_admin;
  const isReadOnlyAdmin   = superAdminScope === 'read';
  // A Read-only Super Admin makes no changes anywhere — every action affordance is hidden.
  // `canAct` is the single question pages ask before rendering an edit/delete/toggle control.
  const canAct            = !isReadOnlyAdmin;
  // Legacy flag: the role value OR the new grant. Kept so existing checks keep working.
  const isSuperAdmin    = !!(user && (user.role === 'super_admin' || user.is_super_admin));
  // Console-only session: a super_admin who signed in through the Admin Login button. The app shows
  // ONLY the Admin Console for them — no business Leads/Dashboard/Forecast/Reports.
  const isConsoleOnly   = !!(consoleMode && user && user.role === 'super_admin');
  const isBusinessAdmin = user && user.role === 'business_admin';
  const isBD            = user && user.role === 'bd';
  // A 'forecast' account can see ONLY the Forecast dashboard.
  const isForecastOnly  = user && user.role === 'forecast';
  // Full user management (assign PMO/BD/Forecast, and — for super_admin — Business Admins across
  // businesses). A PMO can still add BDs; that's handled per-action, not by this flag.
  const canManageUsers  = user && (user.role === 'super_admin' || user.role === 'business_admin');
  // Who can add/remove lead-form dropdown options (device SKUs, sources, partners, ratings, …): the
  // admin tier including PMO. Non-super roles are scoped to their own business by the API.
  const canManageDropdowns = user && (user.role === 'super_admin' || user.role === 'business_admin' || user.role === 'pmo');
  // Forecast access now comes from the per-module level (Settings -> Access), seeded from the
  // legacy forecast_access flag by migration 020. Kept as a named flag because several components
  // still read it, but it is no longer a separate switch.
  const canForecast     = meets(user?.permissions, 'forecast', 'read');

  // --- Per-module access levels (second dimension alongside role and business_unit) -------------
  // The server resolves these and returns them on /api/auth/me; role-derived defaults are filled in
  // there, so an empty map here means genuinely no access rather than "not configured".
  const permissions = user?.permissions || {};
  // can('leads', 'edit') — at least that level in that module.
  const can = useCallback((module, minLevel = 'read') => meets(user?.permissions, module, minLevel), [user]);
  // Convenience wrappers for the three questions pages actually ask.
  const canView = useCallback((module) => meets(user?.permissions, module, 'read'), [user]);
  const canEdit = useCallback((module) => meets(user?.permissions, module, 'edit'), [user]);
  const canFull = useCallback((module) => meets(user?.permissions, module, 'full'), [user]);
  // Who may open the permission editor. Server-side this is the same admin tier that already
  // manages users, so it grants nothing new.
  const canManagePermissions = !!user?.can_manage_permissions;

  const value = {
    user, loading, login, logout, isAuthenticated, isAdmin, isSuperAdmin, isConsoleOnly,
    isBusinessAdmin, isBD, isForecastOnly, canManageUsers, canManageDropdowns, canForecast,
    permissions, can, canView, canEdit, canFull, canManagePermissions,
    superAdminScope, isCrossPlatform, isReadOnlyAdmin, canAct,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
