import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadForkCreateInput,
  canForkThread,
  threadForkTipTurnId,
  type ThreadForkServerConfig,
} from "./threadFork.ts";

const THREAD_ID = ThreadId.make("thread-1");
const FORKED_THREAD_ID = ThreadId.make("thread-2");
const TURN_ID = TurnId.make("turn-1");
const INSTANCE_ID = ProviderInstanceId.make("codex-default");
const OTHER_INSTANCE_ID = ProviderInstanceId.make("claude-default");
const PARENT_THREAD_ID = ThreadId.make("thread-parent");
const AT = "2026-04-10T11:00:00.000Z";

type ForkSource = Parameters<typeof buildThreadForkCreateInput>[0]["source"];
type SessionStatus = NonNullable<ForkSource["session"]>["status"];
type TurnState = NonNullable<ForkSource["latestTurn"]>["state"];

function makeSource(
  input: {
    readonly archivedAt?: string;
    readonly deletedAt?: string;
    readonly sessionStatus?: SessionStatus | null;
    readonly sessionInstanceId?: ProviderInstanceId;
    readonly turn?: { readonly state: TurnState; readonly completedAt: string | null } | null;
    readonly worktreePath?: string | null;
  } = {},
): ForkSource {
  const sessionStatus = input.sessionStatus === undefined ? "ready" : input.sessionStatus;
  const turn =
    input.turn === undefined ? ({ state: "completed", completedAt: AT } as const) : input.turn;
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Fix the flaky test",
    modelSelection: { instanceId: INSTANCE_ID, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/x",
    worktreePath: input.worktreePath === undefined ? "/work/tree" : input.worktreePath,
    archivedAt: input.archivedAt ?? null,
    deletedAt: input.deletedAt ?? null,
    session:
      sessionStatus === null
        ? null
        : {
            threadId: THREAD_ID,
            status: sessionStatus,
            providerName: "Codex",
            providerInstanceId: input.sessionInstanceId ?? INSTANCE_ID,
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: AT,
          },
    latestTurn:
      turn === null
        ? null
        : {
            turnId: TURN_ID,
            state: turn.state,
            requestedAt: "2026-04-10T10:00:00.000Z",
            startedAt: null,
            completedAt: turn.completedAt,
            assistantMessageId: null,
          },
  };
}

function makeServerConfig(
  input: {
    readonly threadFork?: boolean;
    readonly supportsThreadFork?: boolean;
    readonly instanceId?: ProviderInstanceId;
  } = {},
): ThreadForkServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("env-1"),
      label: "laptop",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "1.0.0",
      capabilities: {
        repositoryIdentity: true,
        ...(input.threadFork === undefined ? {} : { threadFork: input.threadFork }),
      },
    },
    providers: [
      {
        instanceId: input.instanceId ?? INSTANCE_ID,
        driver: ProviderDriverKind.make("codex"),
        ...(input.supportsThreadFork === undefined
          ? {}
          : { supportsThreadFork: input.supportsThreadFork }),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: AT,
        models: [],
        slashCommands: [],
        skills: [],
      },
    ],
  };
}

const CAPABLE = makeServerConfig({ threadFork: true, supportsThreadFork: true });

describe("canForkThread", () => {
  it("allows a forkable thread on a capable server and provider", () => {
    expect(canForkThread(makeSource(), CAPABLE)).toBe(true);
  });

  // Both flags are absent-means-FALSE. A `?? true` default here would show the
  // action against every older server and every provider that cannot fork.
  it("refuses when either capability flag is absent or false", () => {
    expect(canForkThread(makeSource(), makeServerConfig({ supportsThreadFork: true }))).toBe(false);
    expect(canForkThread(makeSource(), makeServerConfig({ threadFork: true }))).toBe(false);
    expect(
      canForkThread(
        makeSource(),
        makeServerConfig({ threadFork: true, supportsThreadFork: false }),
      ),
    ).toBe(false);
    expect(canForkThread(makeSource(), null)).toBe(false);
  });

  it("resolves the provider from the live session, not the model selection", () => {
    const source = makeSource({ sessionInstanceId: OTHER_INSTANCE_ID });
    // Only the model-selection instance advertises the capability, and the
    // session has moved off it.
    expect(canForkThread(source, CAPABLE)).toBe(false);
    expect(
      canForkThread(
        source,
        makeServerConfig({
          threadFork: true,
          supportsThreadFork: true,
          instanceId: OTHER_INSTANCE_ID,
        }),
      ),
    ).toBe(true);
  });

  it("refuses archived, deleted, sessionless and busy threads", () => {
    expect(canForkThread(makeSource({ archivedAt: AT }), CAPABLE)).toBe(false);
    expect(canForkThread(makeSource({ deletedAt: AT }), CAPABLE)).toBe(false);
    expect(canForkThread(makeSource({ sessionStatus: null }), CAPABLE)).toBe(false);
    expect(canForkThread(makeSource({ sessionStatus: "running" }), CAPABLE)).toBe(false);
    expect(canForkThread(makeSource({ sessionStatus: "starting" }), CAPABLE)).toBe(false);
    expect(
      canForkThread(makeSource({ turn: { state: "running", completedAt: null } }), CAPABLE),
    ).toBe(false);
  });

  it("offers the fork on an unrun fork, whose conversation is its parent's", () => {
    // A fork that has not taken a turn owns no session, but it renders a full
    // inherited transcript. Blocking it would strand it: the user sees the
    // conversation and cannot branch from it. The cursor resolves through the
    // lineage server-side.
    expect(canForkThread(makeSource({ sessionStatus: null }), CAPABLE)).toBe(false);
    expect(
      canForkThread(
        { ...makeSource({ sessionStatus: null }), forkedFrom: { threadId: PARENT_THREAD_ID } },
        CAPABLE,
      ),
    ).toBe(true);
  });

  it("offers the fork when the shell carries no latest turn", () => {
    // `latestTurnId` is unset on the large majority of real threads, including
    // ones with dozens of completed turns, so treating it as proof that the
    // agent has state to seed from hid the action almost everywhere. Whether a
    // provider conversation exists is a server-side check against the session
    // binding's resume cursor.
    expect(canForkThread(makeSource({ turn: null }), CAPABLE)).toBe(true);
  });
});

describe("threadForkTipTurnId", () => {
  it("pins only a completed turn", () => {
    expect(threadForkTipTurnId(makeSource())).toBe(TURN_ID);
    expect(
      threadForkTipTurnId(makeSource({ turn: { state: "interrupted", completedAt: AT } })),
    ).toBe(null);
    expect(threadForkTipTurnId(makeSource({ turn: null }))).toBe(null);
  });
});

describe("buildThreadForkCreateInput", () => {
  it("points a shared fork at the parent's worktree and pins the tip", () => {
    const input = buildThreadForkCreateInput({
      source: makeSource(),
      threadId: FORKED_THREAD_ID,
      worktree: "shared",
    });
    expect(input.threadId).toBe(FORKED_THREAD_ID);
    expect(input.branch).toBe("feature/x");
    expect(input.worktreePath).toBe("/work/tree");
    expect(input.forkedFrom).toEqual({
      threadId: THREAD_ID,
      worktree: "shared",
      tipTurnId: TURN_ID,
    });
  });

  // The server creates the new worktree from `forkedFrom.worktree`; the client
  // cannot know its path or branch up front.
  it("leaves branch and worktree unset for a new-worktree fork", () => {
    const input = buildThreadForkCreateInput({
      source: makeSource(),
      threadId: FORKED_THREAD_ID,
      worktree: "new",
    });
    expect(input.branch).toBe(null);
    expect(input.worktreePath).toBe(null);
    expect(input.forkedFrom?.worktree).toBe("new");
  });

  it("omits tipTurnId when no completed turn can be proven", () => {
    const input = buildThreadForkCreateInput({
      source: makeSource({ turn: { state: "interrupted", completedAt: AT } }),
      threadId: FORKED_THREAD_ID,
      worktree: "shared",
    });
    expect(input.forkedFrom).toEqual({ threadId: THREAD_ID, worktree: "shared" });
  });
});
