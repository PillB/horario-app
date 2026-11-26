/**
 * planSignal — tells every plan reader that the server just refused a write for
 * the plan (HTTP 402), so what the screens show follows the server at once
 * (CHG-109, F-3 / F-10). Before, a trial that ended mid-session was only
 * noticed by the next write; the plan banners and Profile kept showing the
 * trial until the tab was left or the page reloaded.
 *
 * `useSubscription` listens and reads the plan again. The server still decides
 * every limit; this only makes the screens catch up.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Called by the proxy clients when an answer is 402. */
export function reportPlanRefusal(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribes to plan refusals; returns the unsubscribe. */
export function onPlanRefusal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
