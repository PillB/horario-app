import { isPublicRoute } from '@/components/TourSpotlight';

describe('guided tour stays off public pages', () => {
  it.each(['/welcome', '/sign-in', '/sign-up', '/sign-up/verify'])('%s is public', (path) => {
    expect(isPublicRoute(path)).toBe(true);
  });
  it.each(['/', '/scheduler', '/explore', '/welcomed', null, undefined])('%s is the app', (path) => {
    expect(isPublicRoute(path)).toBe(false);
  });
});
