import {
  ThreadId,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildForkThreadTitle, selectThreadForks, threadHasOwnTurns } from "./threadFork";

const TIP_TURN = TurnId.make("turn-1");

function latestTurn(overrides: Partial<OrchestrationLatestTurn> = {}): OrchestrationLatestTurn {
  return {
    turnId: TIP_TURN,
    state: "completed",
    requestedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:01.000Z",
    completedAt: "2026-01-01T00:00:02.000Z",
    assistantMessageId: null,
    ...overrides,
  } as OrchestrationLatestTurn;
}

describe("buildForkThreadTitle", () => {
  it("marks the fork apart from its parent", () => {
    expect(buildForkThreadTitle({ parentTitle: "Ship RPC", siblingTitles: [] })).toBe(
      "Ship RPC (fork)",
    );
  });

  it("numbers repeat forks of the same parent", () => {
    expect(
      buildForkThreadTitle({
        parentTitle: "Ship RPC",
        siblingTitles: ["Ship RPC (fork)", "Ship RPC (fork 2)"],
      }),
    ).toBe("Ship RPC (fork 3)");
  });

  it("does not stack suffixes when forking a fork", () => {
    expect(buildForkThreadTitle({ parentTitle: "Ship RPC (fork 2)", siblingTitles: [] })).toBe(
      "Ship RPC (fork)",
    );
  });
});

describe("selectThreadForks", () => {
  it("finds the children of a parent thread", () => {
    const parentId = ThreadId.make("thread-1");
    const threads = [
      { id: ThreadId.make("a"), forkedFrom: { threadId: parentId } },
      { id: ThreadId.make("b"), forkedFrom: null },
      { id: ThreadId.make("c"), forkedFrom: { threadId: ThreadId.make("other") } },
    ] as unknown as ReadonlyArray<OrchestrationThreadShell>;
    expect(selectThreadForks(threads, parentId).map((thread) => thread.id)).toEqual([
      ThreadId.make("a"),
    ]);
  });
});

describe("threadHasOwnTurns", () => {
  it("counts messages for an ordinary thread", () => {
    expect(threadHasOwnTurns({ forkedFrom: null, latestTurn: null, messages: [] })).toBe(false);
    expect(threadHasOwnTurns({ forkedFrom: null, latestTurn: null, messages: [{}] })).toBe(true);
  });

  it("ignores the copied history of a fork until it runs a turn of its own", () => {
    const forkedFrom = { threadId: ThreadId.make("thread-1"), tipTurnId: TIP_TURN };
    expect(
      threadHasOwnTurns({ forkedFrom, latestTurn: latestTurn(), messages: [{}, {}, {}] }),
    ).toBe(false);
    expect(
      threadHasOwnTurns({
        forkedFrom,
        latestTurn: latestTurn({ turnId: TurnId.make("turn-9") }),
        messages: [{}, {}, {}],
      }),
    ).toBe(true);
  });

  it("falls back to the message count when the fork origin pinned no tip", () => {
    expect(
      threadHasOwnTurns({
        forkedFrom: { threadId: ThreadId.make("thread-1") },
        latestTurn: latestTurn(),
        messages: [{}],
      }),
    ).toBe(true);
  });
});
