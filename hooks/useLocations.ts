import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteLocation,
  listLocations,
  upsertLocation,
  type BusinessLocation,
  type LocationInput,
  type LocationResult,
} from '@/services/locationService';
import { newUuid } from '@/utils/schedulingValidation';

/**
 * The tenant's business locations. `accountId` only triggers a refetch when
 * the active tenant changes; the server derives the tenant from the session.
 */
export const useLocations = (accountId: string) => {
  const [locations, setLocations] = useState<BusinessLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Only the latest list request may update state (see useDemandForecast).
  const requestIdRef = useRef(0);
  const listInFlightRef = useRef(false);
  const newLocationIdRef = useRef<string | null>(null);
  const locationsRef = useRef<BusinessLocation[]>([]);
  locationsRef.current = locations;

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    listInFlightRef.current = true;
    setLoading(true);
    const result = await listLocations();
    if (requestIdRef.current !== requestId) return;
    listInFlightRef.current = false;
    if (result.ok) {
      setLocations(result.data);
      setError(null);
      setLoaded(true);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, accountId]);

  const save = useCallback(async (input: LocationInput): Promise<LocationResult<BusinessLocation>> => {
    setSaving(true);
    // A new location gets its id here and keeps it until a save succeeds: if
    // the answer to a save is lost, saving again updates that row instead of
    // adding a second location.
    const id = input.id ?? (newLocationIdRef.current ??= newUuid());
    // An edit is saved only if the location is still as this screen read it.
    const known = input.id ? locationsRef.current.find((l) => l.id === input.id) : undefined;
    const result = await upsertLocation({ ...input, id }, known?.updatedAt);
    setSaving(false);
    // Someone else changed or deleted it (409 / 404), or the answer was lost: show what is stored.
    if (!result.ok) void refresh();
    if (result.ok) {
      if (!input.id) newLocationIdRef.current = null;
      // A list that started before this write may not include it: reload.
      if (listInFlightRef.current) void refresh();
      setLocations((prev) => {
        const index = prev.findIndex((l) => l.id === result.data.id);
        if (index === -1) return [...prev, result.data];
        const next = prev.slice();
        next[index] = result.data;
        return next;
      });
      setError(null);
    }
    return result;
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<LocationResult<true>> => {
    const result = await deleteLocation(id);
    if (result.ok) {
      if (listInFlightRef.current) void refresh();
      setLocations((prev) => prev.filter((l) => l.id !== id));
    }
    return result;
  }, [refresh]);

  return { locations, loading, loaded, error, saving, refresh, save, remove };
};
