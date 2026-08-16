import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Paginated, WorkOrderRow } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useReferenceData } from '../hooks/useReferenceData';
import { Alert, Empty, Field, Panel, Spinner, StatusBadge, useFlash } from '../components/ui';

export function WorkOrdersPage() {
  const { can } = useAuth();
  const { locations, items, users, ready } = useReferenceData();

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useFlash();
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<WorkOrderRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Paginated<WorkOrderRow>>('/work-orders', {
        status: statusFilter,
        limit: 100,
      });
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load work orders.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const advance = async (row: WorkOrderRow, status: 'IN_PROGRESS' | 'COMPLETED') => {
    setError('');
    setNotice('');
    try {
      const res = await api.patch<WorkOrderRow>(`/work-orders/${row.id}/status`, { status });
      setNotice(
        status === 'IN_PROGRESS'
          ? `${res.code} started — ${res.requiredQty} units are now reserved at ${res.locationCode}.`
          : `${res.code} completed — material consumed.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the work order.');
    }
  };

  const openDetail = async (row: WorkOrderRow) => {
    const res = await api.get<WorkOrderRow>(`/work-orders/${row.id}`);
    setDetail(res);
  };

  return (
    <>
      <div className="page-head">
        <h1>Work Orders</h1>
        <p className="page-sub">
          Shortage is calculated live against stock at the work order's location — it is never stored,
          so it cannot go stale.
        </p>
      </div>

      {can('ADMIN') && ready ? (
        <CreateWorkOrder
          locations={locations}
          items={items}
          users={users.filter((u) => u.role !== 'SALES')}
          onDone={load}
        />
      ) : (
        <Alert kind="info">
          Only an Admin can create work orders. You can still view them and, as Operations, move them
          along.
        </Alert>
      )}

      <Panel
        title="All work orders"
        actions={
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
        }
      >
        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{notice}</Alert>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No work orders yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Location</th>
                  <th>Item</th>
                  <th className="num">Required</th>
                  <th className="num">Available</th>
                  <th className="num">Shortage</th>
                  <th>Material</th>
                  <th>Status</th>
                  <th>Assigned to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.code}</td>
                    <td>
                      <strong>{r.locationCode}</strong>
                    </td>
                    <td>
                      <span className="mono">{r.sku}</span> <span className="muted">{r.itemName}</span>
                    </td>
                    <td className="num">{r.requiredQty}</td>
                    <td className="num">{r.availableQty}</td>
                    <td className={`num ${r.shortageQty > 0 ? 'neg' : ''}`}>{r.shortageQty || '—'}</td>
                    <td>
                      <StatusBadge status={r.materialStatus} />
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="muted">{r.assignedToName}</td>
                    <td className="row-actions">
                      {r.status === 'ASSIGNED' && can('ADMIN', 'OPERATIONS') ? (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={!r.canStart}
                          title={r.canStart ? '' : `Short by ${r.shortageQty} — transfer stock in first`}
                          onClick={() => advance(r, 'IN_PROGRESS')}
                        >
                          Start
                        </button>
                      ) : null}
                      {r.status === 'IN_PROGRESS' && can('ADMIN', 'OPERATIONS') ? (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => advance(r, 'COMPLETED')}
                        >
                          Complete
                        </button>
                      ) : null}
                      {r.shortageQty > 0 ? (
                        <button type="button" className="btn btn-link" onClick={() => openDetail(r)}>
                          Where from?
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

      {detail ? (
        <Panel
          title={`${detail.code} — covering the shortage of ${detail.shortageQty}`}
          actions={
            <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
              Close
            </button>
          }
        >
          {detail.suggestedSources && detail.suggestedSources.length > 0 ? (
            <>
              <p className="page-sub">
                These locations hold {detail.sku} and could cover the shortage. Raise an internal
                transfer from the Transfers screen.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Name</th>
                      <th className="num">Available</th>
                      <th className="num">Covers shortage?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.suggestedSources.map((s) => (
                      <tr key={s.locationId}>
                        <td>
                          <strong>{s.locationCode}</strong>
                        </td>
                        <td>{s.locationName}</td>
                        <td className="num">{s.availableQty}</td>
                        <td className="num">
                          {s.availableQty >= detail.shortageQty ? (
                            <span className="badge badge-green">Fully</span>
                          ) : (
                            <span className="badge badge-amber">Partly</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty>No other location currently holds this item.</Empty>
          )}
        </Panel>
      ) : null}
    </>
  );
}

function CreateWorkOrder({
  locations,
  items,
  users,
  onDone,
}: {
  locations: ReturnType<typeof useReferenceData>['locations'];
  items: ReturnType<typeof useReferenceData>['items'];
  users: ReturnType<typeof useReferenceData>['users'];
  onDone: () => void;
}) {
  const [form, setForm] = useState({ locationId: '', itemId: '', requiredQty: '', assignedToId: '' });
  const [result, setResult] = useState<WorkOrderRow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const res = await api.post<WorkOrderRow>('/work-orders', {
        locationId: form.locationId,
        itemId: form.itemId,
        requiredQty: Number(form.requiredQty),
        assignedToId: form.assignedToId,
      });
      setResult(res);
      setForm((f) => ({ ...f, requiredQty: '' }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the work order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Create a work order">
      <form className="form-grid" onSubmit={submit}>
        <Field label="Location">
          <select
            required
            value={form.locationId}
            onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
          >
            <option value="">Select a location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Item required">
          <select
            required
            value={form.itemId}
            onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}
          >
            <option value="">Select an item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Required quantity">
          <input
            required
            type="number"
            min={1}
            step={1}
            value={form.requiredQty}
            onChange={(e) => setForm((f) => ({ ...f, requiredQty: e.target.value }))}
          />
        </Field>

        <Field label="Assign to">
          <select
            required
            value={form.assignedToId}
            onChange={(e) => setForm((f) => ({ ...f, assignedToId: e.target.value }))}
          >
            <option value="">Select a user</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </Field>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create work order'}
          </button>
        </div>
      </form>

      <Alert kind="error">{error}</Alert>

      {result ? (
        <Alert kind={result.shortageQty > 0 ? 'info' : 'success'}>
          <strong>{result.code}</strong> created. Requires {result.requiredQty}, available{' '}
          {result.availableQty} at {result.locationCode} —{' '}
          {result.shortageQty > 0 ? (
            <>
              <strong>short by {result.shortageQty}</strong>. Raise an internal transfer to cover it.
            </>
          ) : (
            <>material is sufficient, ready to start.</>
          )}
        </Alert>
      ) : null}
    </Panel>
  );
}
