import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PrivateRoute, AdminRoute, ModuleRoute } from './components/PrivateRoute';
import LoginPage from './pages/LoginPage';
import LeadsPage from './pages/LeadsPage';
import DashboardPage from './pages/DashboardPage';
import ForecastPage from './pages/ForecastPage';
import ActivityPage from './pages/ActivityPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import VocPage from './pages/VocPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import { GLOBAL_CSS } from './globalStyles';

export default function App() {
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LoginPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* Forecast is login-gated on the Forecast module level. */}
            <Route path="/forecast" element={<ModuleRoute module="forecast"><ForecastPage /></ModuleRoute>} />

            {/* Authenticated — any role */}
            <Route path="/leads"            element={<PrivateRoute><ModuleRoute module="leads"><LeadsPage /></ModuleRoute></PrivateRoute>} />
            <Route path="/dashboard"        element={<PrivateRoute><ModuleRoute module="dashboard"><DashboardPage /></ModuleRoute></PrivateRoute>} />
            {/* Global activity feed. Gated on Leads read — the same visibility the feed itself
                enforces server-side — rather than being a 5th module, which under the E1 rule
                ("new modules default to No Access") would hide it from everyone on day one. */}
            <Route path="/activity"         element={<PrivateRoute><ModuleRoute module="leads"><ActivityPage /></ModuleRoute></PrivateRoute>} />
            {/* VOC (Voice of Customer) — Surveillance only (gated inside the page + API). */}
            <Route path="/voc"              element={<PrivateRoute><VocPage /></PrivateRoute>} />
            {/* Self-service password change — available to every signed-in user. */}
            <Route path="/change-password"  element={<PrivateRoute><ChangePasswordPage /></PrivateRoute>} />

            {/* Admin/PMO only */}
            <Route path="/reports"          element={<AdminRoute><ModuleRoute module="reports"><ReportsPage /></ModuleRoute></AdminRoute>} />
            <Route path="/settings"         element={<AdminRoute><SettingsPage /></AdminRoute>} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/leads" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}
