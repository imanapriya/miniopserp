import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { InventoryPage } from './pages/InventoryPage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { TransfersPage } from './pages/TransfersPage';
import { OrdersPage } from './pages/OrdersPage';

/**
 * Client-side route guard.
 *
 * This only decides what to render - it is not security. Every endpoint the
 * pages call is independently authenticated and role-checked on the server,
 * so bypassing this in the browser gains nothing.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/work-orders" element={<WorkOrdersPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/orders" element={<OrdersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/inventory" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
