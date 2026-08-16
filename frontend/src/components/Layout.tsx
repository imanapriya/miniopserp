import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/inventory', label: 'Inventory' },
  { to: '/work-orders', label: 'Work Orders' },
  { to: '/transfers', label: 'Internal Transfers' },
  { to: '/orders', label: 'Customer Orders' },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <strong>Mini Operations ERP</strong>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="user-chip">
          <div className="user-meta">
            <span className="user-name">{user?.name}</span>
            <span className="user-role">
              {user?.role}
              {user?.locationCode ? ` · ${user.locationCode}` : ''}
            </span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
