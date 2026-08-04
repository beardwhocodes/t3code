import type { ScopedThreadRef } from "@t3tools/contracts";

// Tiny event bus letting any surface raise the fork dialog without owning its
// React state. The context menus are native (Electron) or a DOM fallback, and
// the command palette closes on `run`, so neither can host the dialog itself.
const FORK_THREAD_EVENT = "t3code:fork-thread";

export interface ForkThreadRequestDetail {
  readonly threadRef: ScopedThreadRef;
}

export function requestThreadFork(threadRef: ScopedThreadRef): void {
  window.dispatchEvent(
    new CustomEvent<ForkThreadRequestDetail>(FORK_THREAD_EVENT, { detail: { threadRef } }),
  );
}

export function onRequestThreadFork(
  listener: (detail: ForkThreadRequestDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<ForkThreadRequestDetail>).detail);
  };
  window.addEventListener(FORK_THREAD_EVENT, handler);
  return () => window.removeEventListener(FORK_THREAD_EVENT, handler);
}
