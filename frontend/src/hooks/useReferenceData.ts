import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { BatchRef, ItemRef, LocationRef, UserRef } from '../api/types';

/** Master data every operational screen needs for its dropdowns. */
export function useReferenceData() {
  const [locations, setLocations] = useState<LocationRef[]>([]);
  const [items, setItems] = useState<ItemRef[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<LocationRef[]>('/locations'),
      api.get<ItemRef[]>('/items'),
      api.get<UserRef[]>('/users'),
    ])
      .then(([l, i, u]) => {
        setLocations(l);
        setItems(i);
        setUsers(u);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  return { locations, items, users, ready };
}

/** Batches for one item, refetched whenever the selected item changes. */
export function useBatches(itemId: string | undefined) {
  const [batches, setBatches] = useState<BatchRef[]>([]);

  useEffect(() => {
    if (!itemId) {
      setBatches([]);
      return;
    }
    api
      .get<BatchRef[]>('/batches', { itemId })
      .then(setBatches)
      .catch(() => setBatches([]));
  }, [itemId]);

  return batches;
}
