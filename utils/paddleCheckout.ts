/**
 * What the /pay page shows for each Paddle.js checkout event (Paddle.js v2:
 * checkout.loaded, checkout.completed, checkout.closed, checkout.error).
 */
export type PayStage = 'loading' | 'open' | 'paid' | 'closed' | 'failed' | 'unavailable';

export function stageForEvent(name: string | undefined, current: PayStage): PayStage {
  switch (name) {
    case 'checkout.loaded':
      return current === 'loading' ? 'open' : current;
    case 'checkout.completed':
      return 'paid';
    case 'checkout.closed':
      // Closing the overlay after paying is still paid.
      return current === 'paid' ? 'paid' : 'closed';
    case 'checkout.error':
      return current === 'paid' ? 'paid' : 'failed';
    default:
      return current;
  }
}
