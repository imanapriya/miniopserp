export type Role = 'ADMIN' | 'OPERATIONS' | 'SALES';
export type WorkOrderStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';
export type TransferStatus = 'REQUESTED' | 'DISPATCHED' | 'RECEIVED';
export type OrderStatus = 'DRAFT' | 'RESERVED' | 'FULFILLED' | 'CANCELLED';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  locationId: string | null;
  locationCode?: string | null;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface LocationRef {
  id: string;
  code: string;
  name: string;
}

export interface CategoryRef {
  id: string;
  code: string;
  name: string;
}

export interface ItemRef {
  id: string;
  sku: string;
  name: string;
  uom: string;
  categoryId: string;
  categoryName: string | null;
}

export interface BatchRef {
  id: string;
  code: string;
  itemId: string;
  expiryDate: string | null;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
  role: Role;
  locationCode: string | null;
}

export interface InventoryRow {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  uom: string;
  categoryId: string;
  categoryName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  batchId: string;
  batchCode: string;
  expiryDate: string | null;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
}

export interface LedgerRow {
  id: string;
  type: string;
  physicalDelta: number;
  reservedDelta: number;
  refType: string | null;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface WorkOrderRow {
  id: string;
  code: string;
  status: WorkOrderStatus;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
  materialStatus: 'SUFFICIENT' | 'SHORTAGE' | 'HELD' | 'CONSUMED';
  canStart: boolean;
  locationId: string;
  locationCode: string;
  itemId: string;
  sku: string;
  itemName: string;
  assignedToName: string;
  createdAt: string;
  suggestedSources?: Array<{
    locationId: string;
    locationCode: string;
    locationName: string;
    availableQty: number;
  }>;
}

export interface TransferRow {
  id: string;
  code: string;
  status: TransferStatus;
  quantity: number;
  receivedQty: number;
  outstandingQty: number;
  inTransitQty: number;
  sourceLocationCode: string;
  destinationLocationCode: string;
  sku: string;
  itemName: string;
  batchCode: string;
  workOrderCode: string | null;
  createdAt: string;
}

export interface OrderLine {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  locationId: string;
  locationCode: string;
  quantity: number;
  reservedQty: number;
  shortageQty: number;
}

export interface OrderRow {
  id: string;
  code: string;
  customerName: string;
  status: OrderStatus;
  totalQty: number;
  totalReservedQty: number;
  createdAt: string;
  lines: OrderLine[];
}
