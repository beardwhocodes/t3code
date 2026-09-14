import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationThreadShell } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";

export function isThreadBlockingDesktopRestart(
  thread: Pick<
    OrchestrationThreadShell,
    "session" | "latestTurn" | "hasPendingApprovals" | "hasPendingUserInput" | "backgroundLiveness"
  >,
): boolean {
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.session?.activeTurnId != null ||
    thread.latestTurn?.state === "running" ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.backgroundLiveness === "working"
  );
}

/** Derives a boolean from live summaries, without subscribing to message streams. */
export function createDesktopUpdateIdleAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (id: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    if (
      !catalog.isReady ||
      !Array.from(catalog.entries.values()).some(
        (entry) => entry.enabled && entry.target._tag === "PrimaryConnectionTarget",
      )
    )
      return false;
    for (const id of enabledEnvironmentIds(catalog)) {
      const shell = get(input.shellStateValueAtom(id));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) return false;
      if (shell.snapshot.value.threads.some(isThreadBlockingDesktopRestart)) return false;
    }
    return true;
  });
}
