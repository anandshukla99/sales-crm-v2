import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as adminLogin, bdLogin, getBds } from '../services/api';
import { useAuth } from '../context/AuthContext';

const BU_LABEL = { signage: 'Signage', jhes: 'JHES', surveillance: 'Surveillance' };
const BU_COLOR = { signage: '#4f46e5', jhes: '#ea580c', surveillance: '#0891b2' };
const BU_DESC  = { signage: 'Digital Signage Solutions', jhes: 'Hospitality & Entertainment Services', surveillance: 'Surveillance & Security Solutions' };

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, user, isAuthenticated, loading } = useAuth();

  const [bu, setBu]           = useState(null);   // 'signage' | 'jhes' | null
  const [selected, setSelected] = useState(null); // { id, name, role, ... }
  const [password, setPassword] = useState('');
  const [pmoEmail, setPmoEmail] = useState('');
  const [bds, setBdList]       = useState([]);
  const [busy, setBusy]        = useState(false);
  const [error, setError]      = useState('');

  // Already signed in? Skip straight to the app.
  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      // Super Admin card → global Admin Console. Forecast card / forecast account → Forecast
      // dashboard. Everyone else → the app (Leads).
      const dest = selected?.role === 'superadmin' ? '/settings'
        : (user.role === 'forecast' || selected?.role === 'forecast') ? '/forecast' : '/leads';
      navigate(dest, { replace: true });
    }
  }, [loading, isAuthenticated, user, selected, navigate]);

  // Load BDs when a business unit is chosen
  useEffect(() => {
    if (!bu) { setBdList([]); return; }
    getBds(bu).then(setBdList).catch(() => setBdList([]));
  }, [bu]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const data = selected.role === 'bd'
        ? await bdLogin(selected.id, password)
        : await adminLogin(pmoEmail, password, bu);
      // The Admin Login button requires an actual super_admin account.
      if (selected.role === 'superadmin' && data.user.role !== 'super_admin') {
        setError('This is not an Admin account. Use your business sign-in instead.');
        return;
      }
      // Mark the session type: signing in via Admin Login opens the global Admin Console ONLY (no
      // business pages), even though this super_admin account is also the Signage admin. A business
      // sign-in clears the flag so that same account gets the full app for its business.
      if (selected.role === 'superadmin') localStorage.setItem('salescrm_console', '1');
      else localStorage.removeItem('salescrm_console');
      login(data.token, data.user);
      // Super Admin card → Admin Console; Forecast card / forecast account → Forecast; else the app.
      const dest = selected.role === 'superadmin' ? '/settings'
        : (selected.role === 'forecast' || data.user.role === 'forecast') ? '/forecast' : '/leads';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  // ---- Step 1: Business unit (+ Forecast-only login) ----
  if (!bu && !selected) return (
    <div style={s.wrap}>
      <div style={{ ...s.card, position: 'relative' }}>
        {/* Admin Login — a small labelled button in the top-right corner. Deliberately separate from
            the business cards: it opens the global Admin Console only, not tied to any business. */}
        <button type="button" onClick={() => { setSelected({ role: 'superadmin', name: 'Admin' }); setError(''); }} title="Admin Login" style={s.adminLogin}>
          <span style={{ fontSize: 13 }}>🛡️</span> Admin Login
        </button>
        <h1 style={s.title}>Sales CRM</h1>
        <p style={s.sub}>Select your business to continue</p>
        {['signage', 'jhes', 'surveillance'].map(b => (
          <button key={b} onClick={() => setBu(b)} style={{ ...s.buButton, borderColor: BU_COLOR[b] }}>
            <div style={{ ...s.buIcon, background: BU_COLOR[b] }}>{BU_LABEL[b][0]}</div>
            <div style={{ textAlign: 'left' }}>
              <div style={s.buName}>{BU_LABEL[b]}</div>
              <div style={s.buDesc}>{BU_DESC[b]}</div>
            </div>
          </button>
        ))}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
          <button onClick={() => { setSelected({ role: 'forecast', name: 'Forecast Dashboard' }); setError(''); }} style={{ ...s.buButton, borderColor: '#a7f3d0', background: '#fff', marginBottom: 0 }}>
            <div style={{ ...s.buIcon, background: '#059669' }}>📊</div>
            <div style={{ textAlign: 'left' }}>
              <div style={s.buName}>Forecast Dashboard</div>
              <div style={s.buDesc}>Sign in with your Forecast account</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );

  // ---- Step 2: Person (BD grid + PMO card) ----
  if (!selected) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <button onClick={() => setBu(null)} style={s.back}>← Back</button>
        <h2 style={s.h2}>Who are you?</h2>
        <p style={s.sub}>Select your profile</p>

        <div style={s.grid}>
          {bds.map(b => (
            <button key={b.id} onClick={() => { setSelected(b); setError(''); }} style={s.person}>
              <div style={{ ...s.initials, background: colorMap(b.color) }}>{b.initials || b.name.slice(0, 2)}</div>
              <div style={s.personName}>{b.name.split(' ')[0]}</div>
            </button>
          ))}
        </div>

        <button
          onClick={() => { setSelected({ role: 'pmo', name: `${BU_LABEL[bu]} Business Admin` }); setError(''); }}
          style={s.pmoCard}>
          <div style={{ ...s.initials, background: '#334155' }}>🔑</div>
          <div style={{ textAlign: 'left' }}>
            <div style={s.personName}>Business Admin / Manager</div>
            <div style={s.buDesc}>{BU_LABEL[bu]} — sign in as Business Admin or PMO</div>
          </div>
        </button>
      </div>
    </div>
  );

  // ---- Step 3: Password ----
  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <button onClick={() => { setSelected(null); setPassword(''); setPmoEmail(''); setError(''); }} style={s.back}>← Back</button>
        <div style={{ ...s.initials, background: selected.role === 'bd' ? colorMap(selected.color) : selected.role === 'forecast' ? '#059669' : selected.role === 'superadmin' ? '#7c3aed' : '#334155', width: 56, height: 56, fontSize: 18 }}>
          {selected.role === 'bd' ? (selected.initials || selected.name.slice(0, 2)) : selected.role === 'forecast' ? '📊' : selected.role === 'superadmin' ? '🛡️' : '🔑'}
        </div>
        <h2 style={{ ...s.h2, marginTop: 16 }}>{selected.name}</h2>
        <p style={s.sub}>{selected.role === 'forecast' ? 'Forecast access' : selected.role === 'superadmin' ? 'Global admin console' : BU_LABEL[bu]}</p>

        <form onSubmit={handleSubmit}>
          {selected.role !== 'bd' && (
            <>
              <label style={s.label}>Email</label>
              <input type="email" value={pmoEmail} onChange={e => setPmoEmail(e.target.value)} required style={s.input} placeholder="admin@yourcompany.com" />
            </>
          )}
          <label style={s.label}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus style={s.input} placeholder="••••••••" />
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={busy || !password} style={s.submit}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// Tailwind class → hex fallback (the reference project doesn't use Tailwind).
function colorMap(cls) {
  const map = {
    'bg-violet-500':  '#8b5cf6',
    'bg-sky-500':     '#0ea5e9',
    'bg-emerald-500': '#10b981',
    'bg-amber-500':   '#f59e0b',
    'bg-orange-500':  '#f97316',
    'bg-teal-500':    '#14b8a6',
    'bg-indigo-500':  '#6366f1',
    'bg-slate-700':   '#334155',
  };
  return map[cls] || '#6366f1';
}

// Inline styles (matches reference app convention — no CSS framework)
const s = {
  wrap:    { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 16, fontFamily: 'Inter, system-ui, sans-serif' },
  card:    { background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400, boxShadow: '0 10px 30px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' },
  title:   { fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' },
  h2:      { fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' },
  sub:     { fontSize: 13, color: '#64748b', margin: '0 0 24px' },
  buButton:{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, border: '2px solid #e2e8f0', background: '#fff', cursor: 'pointer', marginBottom: 10 },
  buIcon:  { width: 40, height: 40, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  buName:  { fontSize: 14, fontWeight: 600, color: '#0f172a' },
  buDesc:  { fontSize: 12, color: '#94a3b8' },
  grid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 },
  person:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 14, borderRadius: 12, border: '2px solid #eef2ff', background: '#fff', cursor: 'pointer' },
  initials:{ width: 40, height: 40, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 },
  personName:{ fontSize: 12, fontWeight: 600, color: '#334155' },
  pmoCard: { width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, border: '2px solid #e2e8f0', background: '#fff', cursor: 'pointer' },
  back:    { background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 },
  label:   { fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6, marginTop: 12 },
  input:   { width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  error:   { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 },
  submit:  { width: '100%', padding: 12, marginTop: 16, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  adminLogin:{ position: 'absolute', top: 18, right: 18, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 999, border: '1.5px solid #e9d5ff', background: '#faf5ff', color: '#7c3aed', fontSize: 12, fontWeight: 700, cursor: 'pointer', lineHeight: 1 },
};
