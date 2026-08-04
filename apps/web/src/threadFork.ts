import type { OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";

// The fork availability rule, the create payload and the workspace wording all
// live in `@t3tools/client-runtime/state/thread-fork` so web and mobile cannot
// drift. Only the web-specific pieces live here.

const FORK_TITLE_PATTERN = /^(.*?)\s*\(fork(?:\s+\d+)?\)$/;

/**
 * A distinct default title for a fork.
 *
 * Neither title regeneration nor the temporary-branch rename ever fires on a
 * fork — both are gated on the thread having exactly one user message, and a
 * fork opens with many — so a fork that inherits its parent's title verbatim
 * leaves two identical rows in every list forever. Forking the same parent
 * twice numbers the suffix instead of repeating it, and forking a fork reuses
 * the original base rather than stacking "(fork) (fork)".
 */
export function buildForkThreadTitle(input: {
  readonly parentTitle: string;
  readonly siblingTitles: ReadonlyArray<string>;
}): string {
  const parentTitle = input.parentTitle.trim();
  const base = FORK_TITLE_PATTERN.exec(parentTitle)?.[1]?.trim() || parentTitle;
  const taken = new Set(input.siblingTitles.map((title) => title.trim()));
  let candidate = `${base} (fork)`;
  for (let attempt = 2; taken.has(candidate); attempt += 1) {
    candidate = `${base} (fork ${attempt})`;
  }
  return candidate;
}

/**
 * The threads forked from `threadId`. Lineage is derived, not stored on the
 * parent: a fork records where it came from and the parent side is a filter.
 */
export function selectThreadForks<T extends Pick<OrchestrationThreadShell, "forkedFrom">>(
  threads: ReadonlyArray<T>,
  threadId: ThreadId,
): ReadonlyArray<T> {
  return threads.filter((thread) => thread.forkedFrom?.threadId === threadId);
}

/**
 * Whether a thread has run a turn of its own.
 *
 * A fork opens with the parent's copied history, so "no messages yet" can never
 * stand in for "has not started". Its own work begins past the fork point:
 * while the latest turn is still the copied tip, the fork has run nothing and
 * must keep the workspace choices a brand-new thread has — otherwise the fork
 * dialog's worktree pick would be a one-way door. A fork whose origin carries
 * no tip (an adapter that could not pin one) degrades to the old rule.
 *
 * Takes the thread DETAIL: `messages` is the non-fork signal and shells do not
 * carry it.
 */
export function threadHasOwnTurns(
  thread: Pick<OrchestrationThreadShell, "forkedFrom" | "latestTurn"> & {
    readonly messages: ReadonlyArray<unknown>;
  },
): boolean {
  const forkTipTurnId = thread.forkedFrom?.tipTurnId;
  if (forkTipTurnId !== undefined) {
    return thread.latestTurn !== null && thread.latestTurn.turnId !== forkTipTurnId;
  }
  return thread.messages.length > 0;
}
