import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getUser, isLoggedIn } from './api';
import { usePerms } from './permissions';
import Layout from './components/Layout';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Invoices from './pages/Invoices';
import Receipts from './pages/Receipts';
import ReceiptRequest from './pages/ReceiptRequest';
import Approval from './pages/Approval';
import Adjustment from './pages/Adjustment';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import Masters from './pages/Masters';
import Users from './pages/Users';
import Settings from './pages/Settings';
import ActivityLog from './pages/ActivityLog';
import SearchResults from './pages/SearchResults';

const Private = ({ children }) => (isLoggedIn() ? children : <Navigate to="/login" replace />);

const AccessDenied = ({ module }) => (
  <div className="panel" style={{ margin: 0 }}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 24 }}>
      <i className="ti ti-lock" style={{ fontSize: 30, color: '#b3261e' }} />
      <div>
        <h3 style={{ margin: '0 0 6px' }}>Access denied</h3>
        <div className="muted">
          You don't have permission to view <b>{module}</b>. Please contact an administrator if you need access.
        </div>
      </div>
    </div>
  </div>
);

// Route-level permission gate. Admins bypass; otherwise requires View on the module.
function Guard({ mod, adminOnly, children }) {
  const { can, ready } = usePerms();
  const role = getUser()?.role;
  const isAdmin = role === 'Super Admin' || role === 'Admin';
  if (isAdmin) return children;
  if (adminOnly) return <AccessDenied module="this area" />;
  if (!mod) return children;
  if (!ready) return null; // wait until the matrix is loaded before deciding
  if (!can(mod, 'View')) return <AccessDenied module={mod} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route element={<Private><Layout /></Private>}>
        <Route path="/" element={<Guard mod="Dashboard"><Dashboard /></Guard>} />
        <Route path="/invoices" element={<Guard mod="Invoice"><Invoices /></Guard>} />
        <Route path="/receipts" element={<Guard mod="Receipt"><Receipts /></Guard>} />
        <Route path="/receipt-request" element={<Guard mod="Receipt"><ReceiptRequest /></Guard>} />
        <Route path="/approval" element={<Guard mod="Receipt Approval"><Approval /></Guard>} />
        <Route path="/adjustment" element={<Guard mod="Invoice Adjustment"><Adjustment /></Guard>} />
        <Route path="/payments" element={<Guard mod="Payment"><Payments /></Guard>} />
        <Route path="/reports" element={<Guard mod="Reports"><Reports /></Guard>} />
        <Route path="/masters" element={<Guard mod="Master Data"><Masters /></Guard>} />
        <Route path="/activity" element={<Guard adminOnly><ActivityLog /></Guard>} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/users" element={<Guard mod="User Management"><Users /></Guard>} />
        <Route path="/settings" element={<Guard mod="Settings"><Settings /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
