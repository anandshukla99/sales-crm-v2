import axios from 'axios';
import { BASE_PATH } from '../env';

// One axios instance for the whole app. In dev, the CRA `proxy` in package.json forwards
// /api → the Express server. In production, set REACT_APP_API_BASE if the API sits on a different
// origin (or leave it empty and proxy /api to the backend at the hosting layer, e.g. netlify.toml).
const api = axios.create({
  baseURL: (process.env.REACT_APP_API_BASE || '') + '/api',
});

// Request interceptor: attach the Bearer token from localStorage on every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('salescrm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: bounce to /login on 401 (let 403 through so the UI can render a
// "not allowed" state).
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('salescrm_token');
      if (!window.location.pathname.startsWith(BASE_PATH + '/login')) {
        window.location.href = BASE_PATH + '/login';
      }
    }
    return Promise.reject(err);
  }
);

// --------------------------------------------------------------------------
// Endpoints — named arrow functions grouped by resource. Pages import
// these; pages never call axios directly.
// --------------------------------------------------------------------------

// Auth
export const login          = (email, password, businessUnit) => api.post('/auth/login', { email, password, business_unit: businessUnit }).then(r => r.data);
export const bdLogin        = (userId, password)              => api.post('/auth/bd-login', { userId, password }).then(r => r.data);
export const getMe          = ()                              => api.get('/auth/me').then(r => r.data);
export const changePassword = (currentPassword, newPassword)  => api.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data);

// Users / BDs
export const getBds         = (businessUnit)                  => api.get('/users', { params: { role: 'bd', business_unit: businessUnit } }).then(r => r.data);
export const resetBdPassword= (id, newPassword)               => api.put(`/users/${id}/reset-password`, { newPassword }).then(r => r.data);
// Full user management (admin only). getManagedUsers lists BD + PMO (including disabled) with
// email/mobile for the Settings page; addUser/updateUser take { name, email, mobile, role }
// (role: 'bd' | 'pmo'). setUserActive enable/disables (soft); deleteUser permanently removes.
export const getManagedUsers= (businessUnit)                  => api.get('/users/manage', { params: { business_unit: businessUnit } }).then(r => r.data);
export const addUser        = (businessUnit, data)            => api.post('/users', { ...data, business_unit: businessUnit }).then(r => r.data);
export const updateUser     = (id, data)                      => api.put(`/users/${id}`, data).then(r => r.data);
export const setUserActive  = (id, active)                    => api.put(`/users/${id}/active`, { active }).then(r => r.data);
export const setForecastAccess = (id, forecastAccess)         => api.put(`/users/${id}/forecast-access`, { forecast_access: forecastAccess }).then(r => r.data);
// reassignTo: undefined (fails with 409 if the user owns leads), 'unassigned', or a target user id.
export const deleteUser     = (id, reassignTo)                => api.delete(`/users/${id}`, reassignTo ? { data: { reassign_to: reassignTo } } : undefined).then(r => r.data);

// Leads
export const getLeads       = (params)                        => api.get('/leads', { params }).then(r => r.data);
export const getLead        = (id)                            => api.get(`/leads/${id}`).then(r => r.data);
export const createLead     = (data)                          => api.post('/leads', data).then(r => r.data);
export const updateLead     = (id, data)                      => api.put(`/leads/${id}`, data).then(r => r.data);
export const deleteLead     = (id)                            => api.delete(`/leads/${id}`).then(r => r.data);
export const bulkUpdateLeads= (ids, patch)                    => api.put('/leads/bulk/update', { ids, ...patch }).then(r => r.data);

// Global POs (chains) — reference-only chain records with derived device-pool status. getGlobalPos
// lists chains (each with { status: {consumed, remaining, exceeded} }); getGlobalPo adds contributors.
export const getGlobalPos   = ()                              => api.get('/global-pos').then(r => r.data);
export const getGlobalPo    = (id)                            => api.get(`/global-pos/${id}`).then(r => r.data);
export const createGlobalPo = (data)                          => api.post('/global-pos', data).then(r => r.data);
export const updateGlobalPo = (id, data)                      => api.put(`/global-pos/${id}`, data).then(r => r.data);
export const deleteGlobalPo = (id)                            => api.delete(`/global-pos/${id}`).then(r => r.data);

// VOC (Voice of Customer) — Surveillance business only.
export const getVocs        = (params)                        => api.get('/voc', { params }).then(r => r.data);
export const getVocStats    = ()                              => api.get('/voc/stats').then(r => r.data);
export const getVoc         = (id)                            => api.get(`/voc/${id}`).then(r => r.data);
export const createVoc      = (data)                          => api.post('/voc', data).then(r => r.data);
export const updateVoc      = (id, data)                      => api.put(`/voc/${id}`, data).then(r => r.data);
export const addVocComment  = (id, note)                      => api.post(`/voc/${id}/comment`, { note }).then(r => r.data);
export const deleteVoc      = (id)                            => api.delete(`/voc/${id}`).then(r => r.data);

// Activity log / stage history
export const getActivityLog = (leadId)                        => api.get('/activity-log', { params: { lead_id: leadId } }).then(r => r.data);
// Global cross-user feed — params: { limit, before, user, platform, type, from, to }
export const getActivityFeed = (params)                       => api.get('/activity-log/feed', { params }).then(r => r.data);
export const getActivityFilters = ()                          => api.get('/activity-log/feed/filters').then(r => r.data);
export const getStageHistory= ()                              => api.get('/stage-history').then(r => r.data);

// Cross-platform Super Admin grant. Super Admins only — managed in its own Settings section.
export const getSuperAdmins = ()                             => api.get('/users/super-admins').then(r => r.data);
export const setSuperAdmin  = (id, scope)                    => api.put(`/users/${id}/super-admin`, { scope }).then(r => r.data);
// Super Admin grant history now comes from the unified activity feed rather than a separate store,
// so it is the same record the global Activity pane shows.
export const getSuperAdminAudit = ()                         => api.get('/activity-log/feed', { params: { type: 'permissions', limit: 50 } })
  .then(r => (r.data.entries || []).filter(e => e.action === 'super_admin_change'));

// Per-module access levels (RBAC). Admin tier only — see backend/services/permissions.js.
export const getUserPermissions = (id)                       => api.get(`/users/${id}/permissions`).then(r => r.data);
export const updateUserPermissions = (id, permissions)       => api.put(`/users/${id}/permissions`, { permissions }).then(r => r.data);

// Forecast (login-gated: admin tier, 'forecast' accounts, or a granted user)
export const getForecastDevices = ()                          => api.get('/forecast/devices').then(r => r.data);
// Manual 'Sent to SCM' handoff marker. Writable by anyone who can see the dashboard row.
export const setSentToScm = (id, sent)                        => api.patch(`/forecast/devices/${id}/sent-to-scm`, { sent_to_scm: sent }).then(r => r.data);

// Settings
export const getSettings    = ()                              => api.get('/settings').then(r => r.data);
export const setSetting     = (key, value)                    => api.put(`/settings/${key}`, { value }).then(r => r.data);

// Stage TAT config (PMO / Business Admin) — per-platform TAT days-per-stage for the confidence engine.
// getTat returns { business_unit, stages: [{ stage, tat_days, weight }] }; updateTat takes { stage: days }.
export const getTat         = (businessUnit)                  => api.get('/sla', { params: { business_unit: businessUnit } }).then(r => r.data);
export const updateTat      = (businessUnit, tats)            => api.put('/sla', { business_unit: businessUnit, tats }).then(r => r.data);

// Dropdowns (per-business). getDropdowns returns { field_name: [values] } for the caller's business.
export const getDropdowns          = ()                       => api.get('/dropdowns').then(r => r.data);
// Management (Super/Business Admin): full option rows (id + value) for one field, add, and remove.
export const getDropdownsManage    = (fieldName)              => api.get('/dropdowns/manage', { params: { field_name: fieldName } }).then(r => r.data);
export const addDropdownOption     = (fieldName, value)       => api.post('/dropdowns', { field_name: fieldName, value }).then(r => r.data);
export const removeDropdownOption  = (id)                     => api.delete(`/dropdowns/${id}`).then(r => r.data);

// Uploads
export const uploadPoDocument = (leadId, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/uploads/po/${leadId}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
};

export const fileUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return (process.env.REACT_APP_API_BASE || '') + path;
};

export default api;
