import { shouldShowBreakPrompt } from '../useSessionWellness';

describe('shouldShowBreakPrompt', () => {
  const config = { breakAfterMinutes: 20, cooldownMinutes: 30 } as const;

  it('does not prompt when no interactions have occurred', () => {
    expect(shouldShowBreakPrompt({ lastActiveAt: null, lastBreakAt: null }, Date.now(), config)).toBe(false);
  });

  it('prompts when active time exceeds the break threshold without a prior break', () => {
    const now = Date.now();
    const twentyFiveMinutesAgo = now - 25 * 60 * 1000;
    expect(shouldShowBreakPrompt({ lastActiveAt: twentyFiveMinutesAgo, lastBreakAt: null }, now, config)).toBe(true);
  });

  it('suppresses prompts during cooldown after a break', () => {
    const now = Date.now();
    const lastActiveAt = now - 40 * 60 * 1000;
    const lastBreakAt = now - 10 * 60 * 1000;
    expect(shouldShowBreakPrompt({ lastActiveAt, lastBreakAt }, now, config)).toBe(false);
  });

  it('re-enables prompts after the cooldown window', () => {
    const now = Date.now();
    const lastActiveAt = now - 70 * 60 * 1000;
    const lastBreakAt = now - 40 * 60 * 1000;
    expect(shouldShowBreakPrompt({ lastActiveAt, lastBreakAt }, now, config)).toBe(true);
  });
});
