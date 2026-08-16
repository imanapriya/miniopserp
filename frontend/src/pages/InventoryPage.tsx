import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { InventoryRow, LedgerRow, Paginated } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useBatches, useReferenceData } from '../hooks/useReferenceData';
import { Alert, Empty, Field, Panel, Spinner, useFlash } from '../components/ui';

export function InventoryPage() {
  const { can } = useAuth();
  const { locations, items, ready } = useReferenceData();

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ locationId: '', itemId: '', q: '' });

  const [ledgerFor, setLedgerFor] = useState<InventoryRow | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<Paginated<InventoryRow>>('/inventory', { ...filters, limit: 100 });
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const openLedger = async (row: InventoryRow) => {
    setLedgerFor(row);
    setLedger([]);
    const res = await api.get<Paginated<LedgerRow>>(`/inventory/${row.id}/transactions`, { limit: 50 });
    setLedger(res.data);
  };

  return (
    <>
      <div className="page-head">
        <h1>Inventory</h1>
        <p className="page-sub">
          Stock is held per item, location and batch. Available is computed by the database as
          physical minus reserved.
        </p>
      </div>

      {can('ADMIN', 'OPERATIONS') && ready ? <ReceiveStock onDone={load} /> : null}

      <Panel
        title="Stock on hand"
        actions={
          <button type="button" className="btn btn-ghost" onClick={load}>
            Refresh
          </button>
        }
      >
        <div className="filters">
          <Field label="Location">
            <select
              value={filters.locationId}
              onChange={(e) => setFilters((f) => ({ ...f, locationId: e.target.value }))}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Item">
            <select
              value={filters.itemId}
              onChange={(e) => setFilters((f) => ({ ...f, itemId: e.target.value }))}
            >
              <option value="">All items</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Search">
            <input
              type="search"
              placeholder="SKU, item or batch"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </Field>
        </div>

        <Alert kind="error">{error}</Alert>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No stock matches these filters.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Batch</th>
                  <th className="num">Physical</th>
                  <th className="num">Reserved</th>
                  <th className="num">Available</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.locationCode}</strong>
                    </td>
                    <td className="mono">{r.sku}</td>
                    <td>{r.itemName}</td>
                    <td className="muted">{r.categoryName}</td>
                    <td className="mono">{r.batchCode}</td>
                    <td className="num">{r.physicalQty}</td>
                    <td className="num">{r.reservedQty}</td>
                    <td className={`num ${r.availableQty === 0 ? 'num-zero' : 'num-strong'}`}>
                      {r.availableQty}
                    </td>
                    <td>
                      <button type="button" className="btn btn-link" onClick={() => openLedger(r)}>
                        History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {ledgerFor ? (
        <Panel
          title={`Movement history — ${ledgerFor.sku} · ${ledgerFor.batchCode} @ ${ledgerFor.locationCode}`}
          actions={
            <button type="button" className="btn btn-ghost" onClick={() => setLedgerFor(null)}>
              Close
            </button>
          }
        >
          {ledger.length === 0 ? (
            <Empty>No movements recorded.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th className="num">Physical Δ</th>
                    <th className="num">Reserved Δ</th>
                    <th>Reference</th>
                    <th>Note</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{new Date(t.createdAt).toLocaleString()}</td>
                      <td className="mono">{t.type}</td>
                      <td className={`num ${t.physicalDelta < 0 ? 'neg' : t.physicalDelta > 0 ? 'pos' : ''}`}>
                        {t.physicalDelta > 0 ? `+${t.physicalDelta}` : t.physicalDelta || '—'}
                      </td>
                      <td className={`num ${t.reservedDelta < 0 ? 'neg' : t.reservedDelta > 0 ? 'pos' : ''}`}>
                        {t.reservedDelta > 0 ? `+${t.reservedDelta}` : t.reservedDelta || '—'}
                      </td>
                      <td className="muted">{t.refType ?? '—'}</td>
                      <td className="muted">{t.note ?? '—'}</td>
                      <td className="muted">{t.createdBy?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </>
  );
}

function ReceiveStock({ onDone }: { onDone: () => void }) {
  const { locations, items } = useReferenceData();
  const [form, setForm] = useState({
    itemId: '',
    locationId: '',
    batchId: '',
    batchCode: '',
    quantity: '',
    reference: '',
  });
  const [useNewBatch, setUseNewBatch] = useState(false);
  const [message, setMessage] = useFlash();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const batches = useBatches(form.itemId || undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await api.post<{ sku: string; locationCode: string; availableQty: number }>(
        '/inventory/receipt',
        {
          itemId: form.itemId,
          locationId: form.locationId,
          ...(useNewBatch ? { batchCode: form.batchCode } : { batchId: form.batchId }),
          quantity: Number(form.quantity),
          ...(form.reference ? { reference: form.reference } : {}),
        },
      );
      setMessage(
        `Received ${form.quantity} × ${res.sku} into ${res.locationCode}. Available is now ${res.availableQty}.`,
      );
      setForm((f) => ({ ...f, quantity: '', reference: '' }));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Receipt failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Receive stock">
      <form className="form-grid" onSubmit={submit}>
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

        <Field label="Batch">
          {useNewBatch ? (
            <input
              required
              placeholder="New batch code"
              value={form.batchCode}
              onChange={(e) => setForm((f) => ({ ...f, batchCode: e.target.value }))}
            />
          ) : (
            <select
              required
              value={form.batchId}
              onChange={(e) => setForm((f) => ({ ...f, batchId: e.target.value }))}
              disabled={!form.itemId}
            >
              <option value="">{form.itemId ? 'Select a batch' : 'Pick an item first'}</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                  {b.expiryDate ? ` (exp ${b.expiryDate})` : ''}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn btn-link btn-tiny"
            onClick={() => setUseNewBatch((v) => !v)}
          >
            {useNewBatch ? 'Choose an existing batch' : 'Create a new batch'}
          </button>
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

        <Field label="Reference" hint="Optional. Blocks the same receipt being posted twice.">
          <input
            placeholder="e.g. GRN-4471"
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          />
        </Field>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Posting…' : 'Receive stock'}
          </button>
        </div>
      </form>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{message}</Alert>
    </Panel>
  );
}
