import { stageForEvent } from '@/utils/paddleCheckout';

describe('/pay page stages', () => {
  it('follows the checkout from loading to paid', () => {
    expect(stageForEvent('checkout.loaded', 'loading')).toBe('open');
    expect(stageForEvent('checkout.completed', 'open')).toBe('paid');
  });

  it('never turns a payment that went through into "nothing was charged"', () => {
    expect(stageForEvent('checkout.closed', 'paid')).toBe('paid');
    expect(stageForEvent('checkout.error', 'paid')).toBe('paid');
    expect(stageForEvent('checkout.closed', 'open')).toBe('closed');
    expect(stageForEvent('checkout.error', 'open')).toBe('failed');
  });

  it('ignores events it does not know', () => {
    expect(stageForEvent('checkout.items.updated', 'open')).toBe('open');
    expect(stageForEvent(undefined, 'loading')).toBe('loading');
  });
});
