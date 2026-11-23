/**
 * Time-travel test run (CHG-103). With HORARIO_TEST_NOW set (an ISO instant),
 * every test file starts with the clock at that instant and running from it.
 * Only `Date` is faked; timers, microtasks and performance stay real, so
 * async tests behave as usual. A test that calls jest.useFakeTimers() or
 * jest.useRealTimers() itself takes over the clock for that file.
 *
 * Used by `npm run test:future` to find tests and code that only work before
 * a date (a "time bomb": a hard-coded "upcoming" date, a dated labor rule
 * whose next phase nobody tested, a trial or plan window computed from now).
 */
/* global jest */
const now = process.env.HORARIO_TEST_NOW;
if (now) {
  const at = Date.parse(now);
  if (Number.isNaN(at)) throw new Error(`HORARIO_TEST_NOW is not an ISO date: ${JSON.stringify(now)}`);
  jest.useFakeTimers({
    now: at,
    advanceTimers: true,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
}
