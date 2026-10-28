/**
 * Test helpers for hooks that talk to the secure proxy: a fake `fetch` that
 * answers by action, and a tiny hook renderer. Not a test file (it lives
 * outside __tests__).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

export type ProxyBody = { action: string; [key: string]: unknown };
export type ProxyReply = { status?: number; body: unknown };
export type ProxyHandler = (body: ProxyBody) => ProxyReply | Promise<ProxyReply>;

/** Replaces global fetch; every request body is parsed and passed to `handler`. */
export const installFakeProxy = (handler: ProxyHandler) => {
  const fetchMock = jest.fn(async (_url: string, options: RequestInit) => {
    const reply = await handler(JSON.parse(options.body as string) as ProxyBody);
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  });
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  return fetchMock;
};

/** Request bodies sent for `action`, in order. */
export const callsOf = (fetchMock: jest.Mock, action: string): ProxyBody[] =>
  fetchMock.mock.calls
    .map((call) => JSON.parse((call[1] as RequestInit).body as string) as ProxyBody)
    .filter((body) => body.action === action);

export type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

export const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Lets pending promises and the state updates they cause settle. */
export const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

/**
 * Renders `useHook(props)` and returns a live view of its latest result plus
 * a way to re-render with new props.
 */
export const renderHook = async <P, T>(useHook: (props: P) => T, initialProps: P) => {
  const state: { current: T | null } = { current: null };
  const Probe = ({ hookProps }: { hookProps: P }) => {
    state.current = useHook(hookProps);
    return null;
  };
  let root!: renderer.ReactTestRenderer;
  await act(async () => {
    root = renderer.create(<Probe hookProps={initialProps} />);
  });
  await flush();
  return {
    get result(): T {
      if (state.current === null) throw new Error('hook did not render');
      return state.current;
    },
    rerender: async (props: P) => {
      await act(async () => {
        root.update(<Probe hookProps={props} />);
      });
      await flush();
    },
    unmount: () => act(() => root.unmount()),
  };
};
