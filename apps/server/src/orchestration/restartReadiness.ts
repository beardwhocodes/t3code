import { isThreadBlockingRestart, type OrchestrationThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** Waits for persisted turn finalization, then checks authoritative thread state again. */
export const awaitRestartReady = Effect.fn("orchestration.awaitRestartReady")(function* <E>(input: {
  readonly readThreads: Effect.Effect<ReadonlyArray<OrchestrationThreadShell>, E>;
  readonly drainCommands: Effect.Effect<void>;
  readonly drainIngestion: Effect.Effect<void>;
  readonly drainCheckpoints: Effect.Effect<void>;
}) {
  if ((yield* input.readThreads).some(isThreadBlockingRestart)) return false;
  yield* input.drainCommands;
  yield* input.drainIngestion;
  yield* input.drainCheckpoints;
  return !(yield* input.readThreads).some(isThreadBlockingRestart);
});
