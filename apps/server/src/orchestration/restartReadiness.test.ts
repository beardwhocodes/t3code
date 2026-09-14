import { describe, it, expect } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { awaitRestartReady } from "./restartReadiness.ts";

const ready: OrchestrationThreadShell = {
  id: ThreadId.make("thread"),
  projectId: ProjectId.make("project"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  pullRequests: [],
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

describe("restart readiness", () => {
  it.effect("waits for message finalization and checkpoint capture despite an idle summary", () =>
    Effect.gen(function* () {
      const ingestionEntered = yield* Deferred.make<void>();
      const messagesPersisted = yield* Deferred.make<void>();
      const checkpointEntered = yield* Deferred.make<void>();
      const checkpointCaptured = yield* Deferred.make<void>();
      const returned = yield* Deferred.make<void>();
      const check = yield* awaitRestartReady({
        readThreads: Effect.succeed([ready]),
        drainCommands: Effect.void,
        drainIngestion: Deferred.succeed(ingestionEntered, undefined).pipe(
          Effect.andThen(Deferred.await(messagesPersisted)),
        ),
        drainCheckpoints: Deferred.succeed(checkpointEntered, undefined).pipe(
          Effect.andThen(Deferred.await(checkpointCaptured)),
        ),
      }).pipe(
        Effect.tap(() => Deferred.succeed(returned, undefined)),
        Effect.forkChild,
      );
      yield* Deferred.await(ingestionEntered);
      expect(yield* Deferred.isDone(returned)).toBe(false);
      expect(yield* Deferred.isDone(checkpointEntered)).toBe(false);
      yield* Deferred.succeed(messagesPersisted, undefined);
      yield* Deferred.await(checkpointEntered);
      expect(yield* Deferred.isDone(returned)).toBe(false);
      yield* Deferred.succeed(checkpointCaptured, undefined);
      expect(yield* Fiber.join(check)).toBe(true);
    }),
  );
  it.effect("rechecks authoritative state after draining", () =>
    Effect.gen(function* () {
      let reads = 0;
      const result = yield* awaitRestartReady({
        readThreads: Effect.sync(() => [
          reads++ === 0 ? ready : { ...ready, backgroundLiveness: "working" as const },
        ]),
        drainCommands: Effect.void,
        drainIngestion: Effect.void,
        drainCheckpoints: Effect.void,
      });
      expect(result).toBe(false);
      expect(reads).toBe(2);
    }),
  );
  it.effect("does not wait on workers while a thread still needs input", () =>
    Effect.gen(function* () {
      const result = yield* awaitRestartReady({
        readThreads: Effect.succeed([{ ...ready, hasPendingUserInput: true }]),
        drainCommands: Effect.die("must not drain"),
        drainIngestion: Effect.die("must not drain"),
        drainCheckpoints: Effect.die("must not drain"),
      });
      expect(result).toBe(false);
    }),
  );
});
