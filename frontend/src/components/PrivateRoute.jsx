import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MODULES, PATH_MODULE, meets } from '../utils/permissions';

// The first module this user can actually see, as a landing spot. Used whenever we have to bounce
// someone off a page: sending them to a module they also lack would just loop.
export function firstAllowedPath(permissions) {
  const order = ['/leads', '/dashboard', '/forecast', '/reports'];
  const found = order.find(p => meets(permissions, PATH_MODULE[p], 'read'));
  return found || null;
}

// Shown when every module is No Access — a real state an admin can create, and far better than
// an infinite redirect between pages the user can't open.
function NoModules({ onSignOut }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>No modules available</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
          Your account doesn't currently have access to any module. Ask an administrator to grant
          access from Settings — it will apply here without signing in again.
        </p>
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

// ModuleRoute — gates a page on a per-module access level, on top of the role checks below.
// 'No Access' means the page is unreachable, not merely disabled: the user is redirected to the
// first module they do hold, exactly as the nav hides it.
export function ModuleRoute({ module, minLevel = 'read', children }) {
  const { isAuthenticated, loading, permissions, isConsoleOnly, logout } = useAuth();
  const location = useLocation();

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (isConsoleOnly) return <Navigate to="/settings" replace />;
  if (meets(permissions, module, minLevel)) return children;

  const fallback = firstAllowedPath(permissions);
  if (!fallback) return <NoModules onSignOut={logout} />;
  if (fallback === location.pathname) return <NoModules onSignOut={logout} />;
  return <Navigate to={fallback} replace />;
}

export { MODULES };

export function PrivateRoute({ children }) {
  const { isAuthenticated, isForecastOnly, isConsoleOnly, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  // A forecast-only account can access nothing but the Forecast dashboard.
  if (isForecastOnly) return <Navigate to="/forecast" replace />;
  // A console-only session (signed in via Admin Login) is confined to the Admin Console; the only
  // PrivateRoute page it may reach is its own password change.
  if (isConsoleOnly && location.pathname !== '/change-password') return <Navigate to="/settings" replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin, isConsoleOnly, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/leads" replace />;
  // Console-only sessions get the Admin Console (Settings) but not business admin pages like Reports.
  if (isConsoleOnly && location.pathname !== '/settings') return <Navigate to="/settings" replace />;
  return children;
}

// Forecast dashboard: requires login AND forecast access (PMO/admin by default, or a PMO grant).
export function ForecastRoute({ children }) {
  const { isAuthenticated, canForecast, isConsoleOnly, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  // The Forecast dashboard is a business view, so a console-only session is sent to the Admin Console.
  if (isConsoleOnly) return <Navigate to="/settings" replace />;
  if (!canForecast) return <Navigate to="/leads" replace />;
  return children;
}
