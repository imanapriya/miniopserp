import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Paginated, TransferRow } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useBatches, useReferenceData } from '../hooks/useReferenceData';
import { Alert, Empty, Field, Panel, Spinner, StatusBadge, useFlash } from '../components/ui';

export function TransfersPage() {
  const { can } = useAuth();
  const { ready } = useReferenceData();

  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useFlash();
  const [statusFilter, setStatusFilter] = useState('');
  const [partial, setPartial] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Paginated<TransferRow>>('/transfers', {
        status: statusFilter,
        limit: 100,
      });
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load transfers.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row: TransferRow, action: 'dispatch' | 'receive') => {
    setError('');
    setNotice('');
    try {
      const qty = partial[row.id];
      const body =
        action === 'receive' && qty ? { quantity: Number(qty) } : action === 'receive' ? {} : undefined;
      const res = await api.post<TransferRow>(`/transfers/${row.id}/${action}`, body);
      setNotice(
        action === 'dispatch'
          ? `${res.code} dispatched — ${res.quantity} left ${res.sourceLocationCode}. Nothing has been added to ${res.destinationLocationCode} yet; the stock is in transit.`
          : `${res.code} received — ${res.receivedQty} of ${res.quantity} now at ${res.destinationLocationCode}.`,
      );
      setPartial((p) => ({ ...p, [row.id]: '' }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The operation was rejected.');
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Internal Transfers</h1>
        <p className="page-sub">
          Dispatch removes stock from the source. The destination is credited only on receipt — in
          between, the quantity is in transit and available at neither end.
        </p>
      </div>

      {can('ADMIN', 'OPERATIONS') && ready ? <CreateTransfer onDone={load} /> : null}

      <Panel
        title="All transfers"
        actions={
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="REQUESTED">Requested</option>
            <option value="DISPATCHED">Dispatched</option>
            <option value="RECEIVED">Received</option>
          </select>
        }
      >
        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{notice}</Alert>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No transfers yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Route</th>
                  <th>Item</th>
                  <th>Batch</th>
                  <th className="num">Qty</th>
                  <th className="num">Received</th>
                  <th className="num">In transit</th>
                  <th>Status</th>
                  <th>Work order</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.code}</td>
                    <td>
                      <strong>{r.sourceLocationCode}</strong>
                      <span className="arrow"> → </span>
                      <strong>{r.destinationLocationCode}</strong>
                    </td>
                    <td>
                      <span className="mono">{r.sku}</span>{' '}
                      <span className="muted">{r.itemName}</span>
                    </td>
                    <td className="mono">{r.batchCode}</td>
                    <td className="num">{r.quantity}</td>
                    <td className="num">{r.receivedQty}</td>
                    <td className={`num ${r.inTransitQty > 0 ? 'num-strong' : ''}`}>
                      {r.inTransitQty || '—'}
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="mono muted">{r.workOrderCode ?? '—'}</td>
                    <td className="row-actions">
                      {can('ADMIN', 'OPERATIONS') && r.status === 'REQUESTED' ? (
                        <button type="button" className="btn btn-small" onClick={() => act(r, 'dispatch')}>
                          Dispatch
                        </button>
                      ) : null}
                      {can('ADMIN', 'OPERATIONS') && r.status === 'DISPATCHED' ? (
                        <span className="inline-form">
                          <input
                            type="number"
                            min={1}
                            max={r.outstandingQty}
                            placeholder={`${r.outstandingQty}`}
                            value={partial[r.id] ?? ''}
                            onChange={(e) => setPartial((p) => ({ ...p, [r.id]: e.target.value }))}
                            title="Leave blank to receive everything outstanding"
                          />
                          <button type="button" className="btn btn-small" onClick={() => act(r, 'receive')}>
                            Receive
                          </button>
                        </span>
                      ) : null}
                      {r.status === 'RECEIVED' ? <span className="muted">Complete</span> : null}
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

function CreateTransfer({ onDone }: { onDone: () => void }) {
  const { locations, items } = useReferenceData();
  const [form, setForm] = useState({
    sourceLocationId: '',
    destinationLocationId: '',
    itemId: '',
    batchId: '',
    quantity: '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useFlash();
  const [busy, setBusy] = useState(false);

  const batches = useBatches(form.itemId || undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api.post<TransferRow>('/transfers', {
        sourceLocationId: form.sourceLocationId,
        destinationLocationId: form.destinationLocationId,
        itemId: form.itemId,
        batchId: form.batchId,
        quantity: Number(form.quantity),
      });
      setNotice(`${res.code} raised (${res.status}). No stock has moved yet — dispatch it when ready.`);
      setForm((f) => ({ ...f, quantity: '' }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise the transfer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Raise an internal transfer">
      <form className="form-grid" onSubmit={submit}>
        <Field label="From">
          <select
            required
            value={form.sourceLocationId}
            onChange={(e) => setForm((f) => ({ ...f, sourceLocationId: e.target.value }))}
          >
            <option value="">Source location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="To">
          <select
            required
            value={form.destinationLocationId}
            onChange={(e) => setForm((f) => ({ ...f, destinationLocationId: e.target.value }))}
          >
            <option value="">Destination location</option>
            {locations
              .filter((l) => l.id !== form.sourceLocationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Item">
          <select
            required
            value={form.itemId}
            onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value, batchId: '' }))}
          >
            <option value="">Select an item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Batch">
          <select
            required
            disabled={!form.itemId}
            value={form.batchId}
            onChange={(e) => setForm((f) => ({ ...f, batchId: e.target.value }))}
          >
            <option value="">{form.itemId ? 'Select a batch' : 'Pick an item first'}</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
                {b.expiryDate ? ` (exp ${b.expiryDate})` : ''}
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
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
          />
        </Field>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Raising…' : 'Raise transfer'}
          </button>
        </div>
      </form>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>
    </Panel>
  );
}
