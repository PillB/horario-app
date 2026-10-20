import { useEffect, useState } from 'react';

/**
 * False during the server (static) render and the client's first render, true
 * after mount.
 *
 * Web pages are rendered to HTML at build time (`web.output: "server"`), so
 * anything derived from the clock, the time zone or the browser locale differs
 * between that HTML and the client's first render, and React aborts hydration
 * (error #418). Gate such text on this hook so both first renders match; the
 * real value appears one commit later.
 */
export function useHasMounted(): boolean {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  return hasMounted;
}
