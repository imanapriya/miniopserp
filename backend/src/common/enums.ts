/**
 * Domain enums.
 *
 * These are stored in PostgreSQL as native enum types so the database itself
 * rejects an invalid status - the application is not the only line of defence.
 */

export enum Role {
  ADMIN = 'ADMIN',
  OPERATIONS = 'OPERATIONS',
  SALES = 'SALES',
}

export enum WorkOrderStatus {
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum TransferStatus {
  REQUESTED = 'REQUESTED',
  DISPATCHED = 'DISPATCHED',
  RECEIVED = 'RECEIVED',
}

export enum OrderStatus {
  DRAFT = 'DRAFT',
  RESERVED = 'RESERVED',
  FULFILLED = 'FULFILLED',
  CANCELLED = 'CANCELLED',
}

export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  CONSUMED = 'CONSUMED',
}

/**
 * Why an inventory bucket changed.
 *
 * Kept explicit rather than a generic +/- so the ledger is human-readable and
 * so movements can be filtered by cause (e.g. "show me all transfer activity").
 */
export enum InventoryTxnType {
  /** Goods received into a location from outside the system. */
  RECEIPT = 'RECEIPT',
  /** Goods consumed or shipped out. */
  ISSUE = 'ISSUE',
  /** Manual correction: stock count, write-off, data fix. */
  ADJUSTMENT = 'ADJUSTMENT',
  /** reservedQty up, physicalQty unchanged. */
  RESERVE = 'RESERVE',
  /** reservedQty down, physicalQty unchanged. */
  RELEASE = 'RELEASE',
  /** Reserved stock actually leaves: physicalQty and reservedQty both down. */
  CONSUME = 'CONSUME',
  /** Dispatched out of the source location of a transfer. */
  TRANSFER_OUT = 'TRANSFER_OUT',
  /** Received into the destination location of a transfer. */
  TRANSFER_IN = 'TRANSFER_IN',
}

/** Valid forward transitions for a work order. */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  [WorkOrderStatus.ASSIGNED]: [WorkOrderStatus.IN_PROGRESS],
  [WorkOrderStatus.IN_PROGRESS]: [WorkOrderStatus.COMPLETED],
  [WorkOrderStatus.COMPLETED]: [],
};

/** Valid forward transitions for a stock transfer. */
export const TRANSFER_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  [TransferStatus.REQUESTED]: [TransferStatus.DISPATCHED],
  [TransferStatus.DISPATCHED]: [TransferStatus.RECEIVED],
  [TransferStatus.RECEIVED]: [],
};
