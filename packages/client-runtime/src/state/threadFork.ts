import type {
  OrchestrationThreadShell,
  ServerConfig,
  ThreadForkWorktreeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import type { CreateThreadInput } from "../operations/commands.ts";

/**
 * The fork source as every list surface already has it: a thread shell. Detail
 * threads satisfy it too — `deletedAt` is optional because shells drop out of
 * the snapshot when deleted and never carry the field, while detail threads do
 * and must gate the same way.
 */
export type ThreadForkSource = Pick<
  OrchestrationThreadShell,
  "archivedAt" | "forkedFrom" | "latestTurn" | "modelSelection" | "session"
> & {
  readonly deletedAt?: string | null;
};

/** The two capability gates plus the provider list needed to resolve them. */
export type ThreadForkServerConfig = Pick<ServerConfig, "environment" | "providers">;

/**
 * The provider instance a thread's work actually runs on. The live session wins
 * because a thread can be adopted by an instance other than the one its model
 * selection names.
 */
export function threadProviderInstanceId(
  thread: Pick<ThreadForkSource, "modelSelection" | "session">,
) {
  return thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
}

/**
 * Whether to offer "Fork thread" for this thread. Every entry point on every
 * client must ask this and nothing else, so the action never appears where the
 * server would refuse it.
 *
 * Both capability flags are ABSENT-MEANS-FALSE and read as `=== true`: an older
 * server sends neither, and a provider instance that cannot seed a session from
 * an existing one sends nothing either. Defaulting either to true would offer an
 * action that fails on use.
 *
 * The lifecycle clauses mirror the decider's fork invariants (not archived, not
 * deleted, a session to fork from, nothing running) so the UI refuses before the
 * round trip rather than after it.
 *
 * It deliberately does NOT require a completed `latestTurn`. That reads as a
 * proxy for "the agent has state to seed from", but it is not one: `latestTurnId`
 * is unset on the large majority of real threads, including threads with dozens
 * of completed turns, so gating on it hides the action almost everywhere. The
 * real precondition is a provider conversation to fork, which lives in the
 * session binding's resume cursor — not on the shell, and not knowable here.
 * `ProviderService` checks it and fails with a specific message, which is the
 * honest place for a precondition only the server can see.
 */
export function canForkThread(
  thread: ThreadForkSource,
  serverConfig: ThreadForkServerConfig | null | undefined,
): boolean {
  if (serverConfig?.environment.capabilities.threadFork !== true) return false;
  const instanceId = threadProviderInstanceId(thread);
  const provider = serverConfig.providers.find((candidate) => candidate.instanceId === instanceId);
  if (provider?.supportsThreadFork !== true) return false;
  if (thread.archivedAt !== null) return false;
  if (thread.deletedAt != null) return false;
  // A thread that never started a session has no conversation to carry over —
  // unless it is itself a fork that has not taken a turn yet, whose conversation
  // is its parent's at the point it forked. Forking that resolves through the
  // lineage server-side, so blocking it here would strand a thread that visibly
  // shows a full transcript.
  if (thread.session === null) return thread.forkedFrom != null;
  if (thread.session.status === "starting" || thread.session.status === "running") return false;
  return thread.latestTurn?.state !== "running";
}

/**
 * Fork point to pin, or null when the shell cannot prove one. Only a COMPLETED
 * turn is a valid tip: an interrupted or failed turn may have left the provider
 * mid-rollout, and adapters that cannot pin fall back to the session's own tip.
 */
export function threadForkTipTurnId(thread: Pick<ThreadForkSource, "latestTurn">): TurnId | null {
  return thread.latestTurn?.state === "completed" ? thread.latestTurn.turnId : null;
}

export interface ThreadForkWorktreeChoice {
  readonly mode: ThreadForkWorktreeMode;
  readonly label: string;
  readonly description: string;
}

/**
 * The workspace question every fork dialog asks, worded once so web and mobile
 * describe the same tradeoff. "New worktree" leads: two threads writing the
 * same files is the surprising option, not the safe one.
 */
export const THREAD_FORK_WORKTREE_CHOICES: ReadonlyArray<ThreadForkWorktreeChoice> = [
  {
    mode: "new",
    label: "New worktree",
    description: "The fork gets its own checkout, so both threads can work without colliding.",
  },
  {
    mode: "shared",
    label: "Share this worktree",
    description: "The fork edits the same files as this thread. Run them one at a time.",
  },
];

/**
 * The `thread.create` payload for a fork. A fork is an ordinary thread creation
 * with a source, so it reuses the thread the user is forking for everything the
 * new thread should inherit: same project, title, model and modes.
 *
 * `worktreePath` is the one field the mode decides. "shared" points the fork at
 * the parent's checkout; "new" leaves branch and path unset because the server
 * creates that worktree from `forkedFrom.worktree` and reports the resulting
 * path back — the client cannot know it up front.
 */
export function buildThreadForkCreateInput(input: {
  readonly source: ThreadForkSource &
    Pick<
      OrchestrationThreadShell,
      "branch" | "id" | "interactionMode" | "projectId" | "runtimeMode" | "title" | "worktreePath"
    >;
  /** Client-minted id for the NEW thread, so the caller can navigate to it. */
  readonly threadId: ThreadId;
  readonly worktree: ThreadForkWorktreeMode;
}): CreateThreadInput {
  const shared = input.worktree === "shared";
  const tipTurnId = threadForkTipTurnId(input.source);
  return {
    threadId: input.threadId,
    projectId: input.source.projectId,
    title: input.source.title,
    modelSelection: input.source.modelSelection,
    runtimeMode: input.source.runtimeMode,
    interactionMode: input.source.interactionMode,
    branch: shared ? input.source.branch : null,
    worktreePath: shared ? input.source.worktreePath : null,
    forkedFrom: {
      threadId: input.source.id,
      worktree: input.worktree,
      ...(tipTurnId === null ? {} : { tipTurnId }),
    },
  };
}
