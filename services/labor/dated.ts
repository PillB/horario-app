import type { DateKey, Dated } from './types';

/** The value in force on `date`: the last entry with from ≤ date (the first entry before any). */
export const resolveDated = <T>(value: Dated<T>, date: DateKey): T => {
  if (!Array.isArray(value) || !value.length || typeof value[0] !== 'object' || value[0] === null || !('from' in (value[0] as object))) {
    return value as T;
  }
  const entries = value as { from: DateKey; value: T }[];
  let current = entries[0].value;
  for (const e of entries) if (e.from <= date) current = e.value;
  return current;
};

/** Applies `fn` to every value of a dated value, keeping its dates. */
export const mapDated = <T>(value: Dated<T>, fn: (v: T) => T): Dated<T> => {
  if (!Array.isArray(value) || !value.length || typeof value[0] !== 'object' || value[0] === null || !('from' in (value[0] as object))) {
    return fn(value as T);
  }
  return (value as { from: DateKey; value: T }[]).map((e) => ({ from: e.from, value: fn(e.value) }));
};
