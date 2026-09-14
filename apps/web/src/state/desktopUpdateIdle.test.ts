import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createDesktopUpdateIdleAtom, isThreadBlockingDesktopRestart } from "./desktopUpdateIdle";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    status,
    snapshot:
      status === "empty"
        ? Option.none()
        : Option.some({
            snapshotSequence: 1,
            updatedAt: "2026-09-04T00:00:00.000Z",
            projects: [],
            threads: [],
          }),
    error: Option.none(),
  };
}

function catalogState(environmentIds: readonly EnvironmentId[]): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      environmentIds.map((environmentId) => [
        environmentId,
        {
          target:
            environmentId === LOCAL
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: environmentId,
                  httpBaseUrl: `https://${environmentId}.example.test`,
                  wsBaseUrl: `wss://${environmentId}.example.test`,
                })
              : new BearerConnectionTarget({
                  environmentId,
                  connectionId: environmentId,
                  label: environmentId,
                }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

describe("desktop restart readiness", () => {
  it("requires live snapshots for primary and remote environments", () => {
    const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
    const shells = Atom.family((_id: EnvironmentId) =>
      Atom.make<EnvironmentShellState>(shellState("empty")),
    );
    const idle = createDesktopUpdateIdleAtom({
      catalogValueAtom: catalog,
      shellStateValueAtom: shells,
    });
    const registry = AtomRegistry.make();
    expect(registry.get(idle)).toBe(false);
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(idle)).toBe(false);
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(idle)).toBe(true);
    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(idle)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(idle)).toBe(true);
    registry.dispose();
  });
  const ready = {
    session: null,
    latestTurn: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    backgroundLiveness: null,
  };
  it("allows settled threads and monitoring-only activity", () => {
    expect(isThreadBlockingDesktopRestart(ready)).toBe(false);
    expect(isThreadBlockingDesktopRestart({ ...ready, backgroundLiveness: "monitoring" })).toBe(
      false,
    );
  });
  it("waits for background work and pending requests", () => {
    expect(isThreadBlockingDesktopRestart({ ...ready, backgroundLiveness: "working" })).toBe(true);
    expect(isThreadBlockingDesktopRestart({ ...ready, hasPendingApprovals: true })).toBe(true);
    expect(isThreadBlockingDesktopRestart({ ...ready, hasPendingUserInput: true })).toBe(true);
  });
  it("waits for active sessions and turns even without pending requests", () => {
    const session = {
      threadId: ThreadId.make("thread"),
      status: "ready" as const,
      providerName: null,
      runtimeMode: "full-access" as const,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-09-14T00:00:00Z",
    };
    expect(isThreadBlockingDesktopRestart({ ...ready, session })).toBe(false);
    expect(
      isThreadBlockingDesktopRestart({ ...ready, session: { ...session, status: "starting" } }),
    ).toBe(true);
    expect(
      isThreadBlockingDesktopRestart({ ...ready, session: { ...session, status: "running" } }),
    ).toBe(true);
    expect(
      isThreadBlockingDesktopRestart({
        ...ready,
        session: { ...session, activeTurnId: TurnId.make("turn") },
      }),
    ).toBe(true);
    expect(
      isThreadBlockingDesktopRestart({
        ...ready,
        latestTurn: {
          turnId: TurnId.make("turn"),
          state: "running",
          requestedAt: "2026-09-14T00:00:00Z",
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ).toBe(true);
  });
});
