import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert } from '../components/ui';

const DEMO_USERS = [
  { email: 'admin@ops-erp.local', role: 'Admin', can: 'Creates work orders, sees reconciliation' },
  { email: 'ops@ops-erp.local', role: 'Operations', can: 'Receives stock, runs transfers' },
  { email: 'sales@ops-erp.local', role: 'Sales', can: 'Raises orders, reserves stock' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('admin@ops-erp.local');
  const [password, setPassword] = useState('Password@123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    const to = (location.state as { from?: string })?.from ?? '/inventory';
    return <Navigate to={to} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>Mini Operations ERP</h1>
        <p className="login-sub">Sign in to continue</p>

        <Alert kind="error">{error}</Alert>

        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="demo-users">
          <p className="demo-title">Demo accounts — password <code>Password@123</code></p>
          {DEMO_USERS.map((u) => (
            <button
              key={u.email}
              type="button"
              className="demo-user"
              onClick={() => {
                setEmail(u.email);
                setPassword('Password@123');
              }}
            >
              <span className="demo-role">{u.role}</span>
              <span className="demo-email">{u.email}</span>
              <span className="demo-can">{u.can}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
