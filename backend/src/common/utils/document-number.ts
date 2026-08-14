import { EntityManager } from 'typeorm';

export const SEQUENCES = {
  workOrder: { sequence: 'work_order_seq', prefix: 'WO' },
  transfer: { sequence: 'stock_transfer_seq', prefix: 'TR' },
  customerOrder: { sequence: 'customer_order_seq', prefix: 'SO' },
} as const;

/**
 * Next document number, e.g. `WO-000042`.
 *
 * Uses a PostgreSQL sequence: `nextval()` is atomic and never returns the same
 * value twice, even to concurrent sessions, so document codes cannot collide.
 * Note that sequence values are deliberately NOT rolled back on abort - a
 * failed request burns a number rather than risking a duplicate, which is the
 * correct trade-off for an identifier.
 */
export async function nextDocumentNumber(
  manager: EntityManager,
  kind: keyof typeof SEQUENCES,
): Promise<string> {
  const { sequence, prefix } = SEQUENCES[kind];
  const rows = await manager.query(`SELECT nextval('${sequence}')::bigint AS value`);
  const value = Number(rows[0].value);
  return `${prefix}-${String(value).padStart(6, '0')}`;
}
