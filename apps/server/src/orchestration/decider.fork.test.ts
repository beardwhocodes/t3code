import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationLatestTurn,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const SOURCE_THREAD_ID = ThreadId.make("thread-source");
const FORK_THREAD_ID = ThreadId.make("thread-fork");
const PROJECT_ID = ProjectId.make("project-1");

function makeSession(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId: SOURCE_THREAD_ID,
    status,
    providerName: "Codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  };
}

function makeLatestTurn(state: OrchestrationLatestTurn["state"]): OrchestrationLatestTurn {
  return {
    turnId: TurnId.make("turn-1"),
    state,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: state === "completed" ? NOW : null,
    assistantMessageId: null,
  };
}

function makeReadModel(
  source: Partial<OrchestrationThread> & { readonly session?: OrchestrationSession | null } = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        threadIds: [SOURCE_THREAD_ID],
      } as unknown as OrchestrationReadModel["projects"][number],
    ],
    threads: [
      {
        id: SOURCE_THREAD_ID,
        projectId: PROJECT_ID,
        title: "Source",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: makeLatestTurn("completed"),
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: makeSession("ready"),
        ...source,
      },
    ],
    updatedAt: NOW,
  };
}

function forkCommand(
  overrides: Partial<Extract<OrchestrationCommand, { type: "thread.create" }>> = {},
): OrchestrationCommand {
  return {
    type: "thread.create",
    commandId: CommandId.make("command-1"),
    threadId: FORK_THREAD_ID,
    projectId: PROJECT_ID,
    title: "Source (fork)",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    forkedFrom: { threadId: SOURCE_THREAD_ID, worktree: "new", tipTurnId: TurnId.make("turn-1") },
    createdAt: NOW,
    ...overrides,
  } as OrchestrationCommand;
}

it.layer(NodeServices.layer)("thread fork decider", (it) => {
  it.effect("creates the fork and carries the source lineage onto thread.created", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: forkCommand(),
        readModel: makeReadModel(),
      });

      expect(Array.isArray(event)).toBe(false);
      const created = event as Extract<typeof event, { type: string }>;
      expect(created.type).toBe("thread.created");
      // The fork is its own aggregate, so the sidebar upserts it through the
      // ordinary new-thread path and no client needs a fork-specific event.
      expect(created.aggregateId).toBe(FORK_THREAD_ID);
      expect(created.payload).toMatchObject({
        threadId: FORK_THREAD_ID,
        forkedFrom: { threadId: SOURCE_THREAD_ID, tipTurnId: "turn-1" },
      });
    }),
  );

  it.effect("leaves thread.created untouched when the command is not a fork", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: forkCommand({ forkedFrom: undefined }),
        readModel: makeReadModel(),
      });

      expect((event as { readonly payload: Record<string, unknown> }).payload.forkedFrom).toBe(
        undefined,
      );
    }),
  );

  it.effect("refuses to fork a source whose session is still coming alive or working", () =>
    Effect.gen(function* () {
      for (const status of ["starting", "running"] as const) {
        const error = yield* decideOrchestrationCommand({
          command: forkCommand(),
          readModel: makeReadModel({ session: makeSession(status) }),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }

      // The same source settles and the fork is allowed.
      const event = yield* decideOrchestrationCommand({
        command: forkCommand(),
        readModel: makeReadModel({ session: makeSession("stopped") }),
      });
      expect((event as { readonly type: string }).type).toBe("thread.created");
    }),
  );

  it.effect("refuses to fork a source with a running turn", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: forkCommand(),
        readModel: makeReadModel({ latestTurn: makeLatestTurn("running") }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to fork a source that has no provider session to copy", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: forkCommand(),
        readModel: makeReadModel({ session: null }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to fork a deleted source", () =>
    Effect.gen(function* () {
      // Deletion is soft, so the row is still present and `requireThread` alone
      // would accept it. This is what `requireThreadNotDeleted` exists for.
      const error = yield* decideOrchestrationCommand({
        command: forkCommand(),
        readModel: makeReadModel({ deletedAt: NOW }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to fork an archived source", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: forkCommand(),
        readModel: makeReadModel({ archivedAt: NOW }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to fork a source that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: forkCommand({
          forkedFrom: { threadId: ThreadId.make("thread-missing"), worktree: "new" },
        }),
        readModel: makeReadModel(),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to fork into a thread id that already exists", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: forkCommand({ threadId: SOURCE_THREAD_ID }),
        readModel: makeReadModel(),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
