import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A success/notice message that clears itself.
 *
 * Without this, a confirmation from an earlier action stays on screen while
 * the user does something else, and it starts to read as the result of the
 * NEW action - which is actively misleading on a stock screen.
 */
export function useFlash(timeoutMs = 7000) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), timeoutMs);
    return () => clearTimeout(timer);
  }, [message, timeoutMs]);
  return [message, setMessage] as const;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    ASSIGNED: 'badge-blue',
    IN_PROGRESS: 'badge-amber',
    COMPLETED: 'badge-green',
    REQUESTED: 'badge-blue',
    DISPATCHED: 'badge-amber',
    RECEIVED: 'badge-green',
    DRAFT: 'badge-grey',
    RESERVED: 'badge-blue',
    FULFILLED: 'badge-green',
    CANCELLED: 'badge-grey',
    SHORTAGE: 'badge-red',
    SUFFICIENT: 'badge-green',
    HELD: 'badge-blue',
    CONSUMED: 'badge-grey',
  };
  return <span className={`badge ${tone[status] ?? 'badge-grey'}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="panel-actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="empty">{label}</p>;
}
