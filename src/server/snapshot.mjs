export const EMPTY_LIMITS = Object.freeze({ status: 'unavailable', asOf: null, fiveHour: null, week: null, fable: null });

// Spec §5.
export function buildSnapshot(store, limits, now) {
  return { v: 1, serverTime: now, sessions: store.list(), focusId: store.focusId(), limits: limits || EMPTY_LIMITS };
}
