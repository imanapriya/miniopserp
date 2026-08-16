import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { OrderRow, Paginated } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useReferenceData } from '../hooks/useReferenceData';
import { Alert, Empty, Field, Panel, Spinner, StatusBadge, useFlash } from '../components/ui';

interface DraftLine {
  itemId: string;
  locationId: string;
  quantity: string;
}

export function OrdersPage() {
  const { can } = useAuth();
  const { ready } = useReferenceData();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useFlash();
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Paginated<OrderRow>>('/orders', { status: statusFilter, limit: 100 });
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load orders.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row: OrderRow, action: 'reserve' | 'cancel' | 'fulfil') => {
    setError('');
    setNotice('');
    try {
      const res = await api.post<OrderRow>(`/orders/${row.id}/${action}`);
      const messages = {
        reserve: `${res.code} reserved — ${res.totalReservedQty} units are now held and unavailable to anyone else.`,
        cancel: `${res.code} cancelled — its reserved stock is available again.`,
        fulfil: `${res.code} fulfilled — the reserved stock has left inventory.`,
      };
      setNotice(messages[action]);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The operation was rejected.');
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Customer Orders</h1>
        <p className="page-sub">
          Reserving holds stock against a row lock, so two users can never reserve the same units —
          the second request is refused, not silently oversold.
        </p>
      </div>

      {can('SALES', 'ADMIN') && ready ? <CreateOrder onDone={load} /> : (
        <Alert kind="info">Only Sales and Admin users can raise customer orders.</Alert>
      )}

      <Panel
        title="All orders"
        actions={
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="RESERVED">Reserved</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        }
      >
        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{notice}</Alert>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No customer orders yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Customer</th>
                  <th>Lines</th>
                  <th className="num">Ordered</th>
                  <th className="num">Reserved</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.code}</td>
                    <td>{r.customerName}</td>
                    <td>
                      <ul className="line-list">
                        {r.lines.map((l) => (
                          <li key={l.id}>
                            <span className="mono">{l.sku}</span> × {l.quantity} @{' '}
                            <strong>{l.locationCode}</strong>
                            {l.reservedQty > 0 ? (
                              <span className="badge badge-blue">{l.reservedQty} held</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="num">{r.totalQty}</td>
                    <td className="num num-strong">{r.totalReservedQty}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="row-actions">
                      {can('SALES', 'ADMIN') && r.status === 'DRAFT' ? (
                        <button type="button" className="btn btn-small" onClick={() => act(r, 'reserve')}>
                          Reserve stock
                        </button>
                      ) : null}
                      {can('SALES', 'ADMIN') && r.status === 'RESERVED' ? (
                        <>
                          <button type="button" className="btn btn-small" onClick={() => act(r, 'fulfil')}>
                            Fulfil
                          </button>
                          <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={() => act(r, 'cancel')}
                          >
                            Cancel
                          </button>
                        </>
                      ) : null}
                      {can('SALES', 'ADMIN') && r.status === 'DRAFT' ? (
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => act(r, 'cancel')}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function CreateOrder({ onDone }: { onDone: () => void }) {
  const { locations, items } = useReferenceData();
  const [customerName, setCustomerName] = useState('');
  const [reserveImmediately, setReserveImmediately] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: '', locationId: '', quantity: '' }]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useFlash();
  const [busy, setBusy] = useState(false);

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api.post<OrderRow>('/orders', {
        customerName,
        reserveImmediately,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          locationId: l.locationId,
          quantity: Number(l.quantity),
        })),
      });
      setNotice(
        reserveImmediately
          ? `${res.code} created and ${res.totalReservedQty} units reserved.`
          : `${res.code} created as a draft. Reserve stock when you are ready.`,
      );
      setCustomerName('');
      setLines([{ itemId: '', locationId: '', quantity: '' }]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Create a customer order">
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Customer">
            <input
              required
              minLength={2}
              placeholder="e.g. Acme Industries"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </Field>

          <Field label="Reserve now" hint="Creates the order and holds the stock in one transaction.">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={reserveImmediately}
                onChange={(e) => setReserveImmediately(e.target.checked)}
              />
              <span>Reserve stock immediately</span>
            </label>
          </Field>
        </div>

        <div className="lines">
          {lines.map((line, index) => (
            <div className="line-row" key={index}>
              <Field label={`Line ${index + 1} — item`}>
                <select
                  required
                  value={line.itemId}
                  onChange={(e) => updateLine(index, { itemId: e.target.value })}
                >
                  <option value="">Select an item</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku} — {i.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Served from">
                <select
                  required
                  value={line.locationId}
                  onChange={(e) => updateLine(index, { locationId: e.target.value })}
                >
                  <option value="">Select a location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Quantity">
                <input
                  required
                  type="number"
                  min={1}
                  step={1}
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
              </Field>

              {lines.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-link btn-tiny"
                  onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLines((ls) => [...ls, { itemId: '', locationId: '', quantity: '' }])}
          >
            Add line
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create order'}
          </button>
        </div>
      </form>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>
    </Panel>
  );
}
