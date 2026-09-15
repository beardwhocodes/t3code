import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { useAtomCommand } from "../state/use-atom-command";
import { orchestrationEnvironment } from "../state/orchestration";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect } from "react";
import { environmentCatalog } from "../connection/catalog";
import { isElectron } from "../env";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { createDesktopUpdateIdleAtom } from "../state/desktopUpdateIdle";
import { desktopUpdateInstall, useDesktopUpdateInstallState } from "../state/desktopUpdateInstall";
import { environmentShell } from "../state/shell";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

const idleAtom = createDesktopUpdateIdleAtom({
  requiresPrimaryEnvironment: !isLocalEnvironmentDisabled(),
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

function reportInstallError(description: string) {
  toastManager.add({ type: "error", title: "Automatic restart cancelled", description });
}

function ScheduledRestart() {
  const idle = useAtomValue(idleAtom);
  const awaitReady = useAtomCommand(orchestrationEnvironment.awaitRestartReady, {
    reportFailure: false,
    reportDefect: false,
  });
  const registry = useContext(RegistryContext);
  const update = useDesktopUpdateState();
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !update) return;
    void desktopUpdateInstall.tryInstall(
      bridge,
      () => idle && registry.get(idleAtom),
      reportInstallError,
      async () => {
        const ids = [...enabledEnvironmentIds(registry.get(environmentCatalog.catalogValueAtom))];
        const results = await Promise.all(
          ids.map((environmentId) => awaitReady({ environmentId, input: {} })),
        );
        if (results.some((result) => result._tag === "Failure")) {
          throw new Error(
            "Could not verify that all environments finished their work. Reconnect and schedule the restart again.",
          );
        }
        return results.every((result) => result._tag === "Success" && result.value);
      },
    );
  }, [idle, registry, update, awaitReady]);
  return null;
}

export function DesktopUpdateInstallCoordinator() {
  const update = useDesktopUpdateState();
  useEffect(() => {
    if (update) desktopUpdateInstall.observeUpdate(update, reportInstallError);
  }, [update]);
  const state = useDesktopUpdateInstallState();
  useEffect(() => () => desktopUpdateInstall.cancel(), []);
  if (!isElectron) return null;
  return (
    <>
      {state.status === "waiting" ? <ScheduledRestart /> : null}
      <AlertDialog
        open={state.status === "confirming"}
        onOpenChange={(open) => {
          if (!open) desktopUpdateInstall.respond("cancel");
        }}
      >
        <AlertDialogPopup className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Install update{state.status !== "idle" ? ` ${state.version}` : ""} and restart?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Restart now to interrupt running threads, or restart automatically once threads
              finish. Automatic restart waits for live connections, pending approvals, and
              background work to finish. You can cancel it before restarting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => desktopUpdateInstall.respond("cancel")}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => desktopUpdateInstall.respond("now")}>
              Restart now
            </Button>
            <Button onClick={() => desktopUpdateInstall.respond("when-idle")}>
              Restart when threads finish
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
