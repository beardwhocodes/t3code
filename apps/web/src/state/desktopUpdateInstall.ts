import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { resolveDesktopUpdateButtonAction } from "../components/desktopUpdate.logic";

export type DesktopUpdateInstallState =
  | { readonly status: "idle" }
  | { readonly status: "confirming" | "waiting" | "installing"; readonly version: string };

/** Owns one restart request for this window; closing or reloading cancels it. */
export function createDesktopUpdateInstallController() {
  let state: DesktopUpdateInstallState = { status: "idle" };
  let resolveConfirmation: ((restartNow: boolean) => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: DesktopUpdateInstallState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    const resolve = resolveConfirmation;
    resolveConfirmation = undefined;
    publish({ status: "idle" });
    resolve?.(false);
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (update: Pick<DesktopUpdateState, "downloadedVersion">): Promise<boolean> => {
      const version = update.downloadedVersion;
      if (state.status !== "idle" || !version) return Promise.resolve(false);
      return new Promise((resolve) => {
        resolveConfirmation = resolve;
        publish({ status: "confirming", version });
      });
    },
    respond: (choice: "now" | "when-idle" | "cancel") => {
      if (state.status !== "confirming") return;
      const resolve = resolveConfirmation;
      resolveConfirmation = undefined;
      publish(
        choice === "when-idle" ? { status: "waiting", version: state.version } : { status: "idle" },
      );
      resolve?.(choice === "now");
    },
    cancel,
    observeUpdate: (update: DesktopUpdateState, onError: (message: string) => void) => {
      if (state.status !== "installing" || update.errorContext !== "install") return;
      cancel();
      onError(update.message ?? "The update could not be installed. Please try again.");
    },
    tryInstall: async (
      bridge: Pick<DesktopBridge, "getUpdateState" | "installUpdate">,
      isIdle: () => boolean,
      onError: (message: string) => void,
      prepare: () => Promise<boolean>,
    ) => {
      if (state.status !== "waiting") return;
      const request = state;
      let installation: DesktopUpdateInstallState | undefined;
      try {
        const update = await bridge.getUpdateState();
        if (state !== request) return;
        if (update.downloadedVersion === request.version && update.status === "checking") return;
        if (
          update.downloadedVersion !== request.version ||
          resolveDesktopUpdateButtonAction(update) !== "install"
        ) {
          cancel();
          onError(
            "The downloaded update changed or is no longer ready. Schedule the restart again.",
          );
          return;
        }
        if (!isIdle()) return;
        if (!(await prepare()) || state !== request || !isIdle()) return;
        installation = { status: "installing", version: request.version };
        publish(installation);
        const result = await bridge.installUpdate({ expectedVersion: request.version });
        if (state !== installation) return;
        // A competing check invalidates the readiness admission. Wait for its
        // state event, then ask the servers again before attempting installation.
        if (
          !result.accepted &&
          result.state.status === "checking" &&
          result.state.downloadedVersion === request.version
        ) {
          publish(request);
          return;
        }
        // Installation normally closes the window. A rejected/failed attempt must
        // never automatically retry and repeatedly interrupt the user's work.
        if (!result.accepted || result.state.errorContext === "install") {
          cancel();
          onError(result.state.message ?? "The update could not be installed. Please try again.");
        }
      } catch (error) {
        if (state !== request && state !== installation) return;
        cancel();
        onError(error instanceof Error ? error.message : "The update could not be installed.");
      }
    },
  };
}

export const desktopUpdateInstall = createDesktopUpdateInstallController();
export const requestDesktopUpdateInstall = desktopUpdateInstall.request;
