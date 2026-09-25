import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BU_CONFIG, ROLE_LABEL } from '../utils/constants';

const NAV_ICONS = {
  leads: '📋', dashboard: '📊', forecast: '📦', reports: '📁', activity: '🕒', settings: '⚙️', 'change-password': '🔒', voc: '🗣️',
};

export default function Sidebar() {
  const { user, logout, isAdmin, isSuperAdmin, isConsoleOnly, canForecast, canView } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');
  const [logoHover, setLogoHover] = useState(false);

  if (!user) return null;

  const toggle = () => {
    setCollapsed(c => {
      localStorage.setItem('sidebarCollapsed', c ? '0' : '1');
      return !c;
    });
  };

  const bu = BU_CONFIG[user.business_unit] || BU_CONFIG.signage;
  // A console-only session (Admin signed in via Admin Login) sees ONLY the Admin Console — no business
  // pages — so it stays fully decoupled from Signage/any business. Everyone else (including the same
  // super_admin signed in through a business card) gets the full operational nav for their business.
  const navItems = isConsoleOnly
    ? [
        { path: '/settings', label: 'Admin Console' },
        { path: '/change-password', label: 'Password' },
      ]
    : [
        // Per-module access: 'No Access' HIDES the module here rather than greying it out, so the
        // nav only ever offers pages the user can actually open. Settings stays role-gated — it is
        // deliberately not part of the per-module model.
        ...(canView('leads') ? [{ path: '/leads', label: 'Leads' }] : []),
        ...(canView('dashboard') ? [{ path: '/dashboard', label: 'Dashboard' }] : []),
        // VOC (Voice of Customer) is Surveillance-only — never shown for other businesses.
        ...(user.business_unit === 'surveillance' ? [{ path: '/voc', label: 'VOC' }] : []),
        ...(canForecast && canView('forecast') ? [{ path: '/forecast', label: 'Forecast' }] : []),
        ...(isAdmin && canView('reports') ? [{ path: '/reports', label: 'Reports' }] : []),
        // Global activity feed — shown to anyone who can read leads, since that is the visibility
        // the feed itself enforces. Permission entries within it stay admin-only.
        ...(canView('leads') ? [{ path: '/activity', label: 'Activity' }] : []),
        ...(isAdmin ? [{ path: '/settings', label: isSuperAdmin ? 'Admin Console' : 'Settings' }] : []),
        // Self-service password change — available to every signed-in user.
        { path: '/change-password', label: 'Password' },
      ];

  return (
    <aside style={{
      width: collapsed ? 64 : 220, flexShrink: 0, background: '#0f172a', color: '#cbd5e1',
      display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0,
      alignSelf: 'flex-start', transition: 'width .15s',
    }}>
      {/* Logo → the app's main entry page ("Select your business to continue"). That screen is the
          pre-login landing, so reaching it ends the current session (same as Sign out). Works for
          every role and business unit. */}
      <button
        type="button"
        onClick={logout}
        onMouseEnter={() => setLogoHover(true)}
        onMouseLeave={() => setLogoHover(false)}
        title="Back to main page (business selection)"
        style={{
          padding: '16px', borderBottom: '1px solid #1e293b', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer', textAlign: 'left',
          background: logoHover ? '#1e293b' : 'transparent', transition: 'background .12s',
        }}>
        {/* Neutral logo tile: the current business unit's colour with its initial. */}
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0, background: bu.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 15,
        }}>
          {(bu.label || 'S').charAt(0)}
        </div>
        {!collapsed && <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Sales CRM</div>}
      </button>

      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              title={collapsed ? item.label : undefined}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', marginBottom: 4, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: active ? '#4f46e5' : 'transparent', color: active ? '#fff' : '#94a3b8',
                fontSize: 13, fontWeight: 600,
              }}>
              <span>{NAV_ICONS[item.path.slice(1)] || '•'}</span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: 12, borderTop: '1px solid #1e293b' }}>
        {!collapsed && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{user.name}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{ROLE_LABEL[user.role] || user.role}{isConsoleOnly ? ' · All businesses' : ` · ${bu.label}`}</div>
          </div>
        )}
        {/* Returns to the main page (business selection). Reaching the pre-login landing ends the
            session, so this uses the same action as sign-out — just labelled "Back". */}
        <button onClick={logout} className="btn btn-sm" style={{ width: '100%', justifyContent: 'center', background: '#1e293b', borderColor: '#334155', color: '#e2e8f0' }}>
          {collapsed ? '←' : '← Back'}
        </button>
        <button onClick={toggle} className="btn btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 6, background: 'transparent', borderColor: '#1e293b', color: '#64748b' }}>
          {collapsed ? '»' : '« Collapse'}
        </button>
      </div>
    </aside>
  );
}
