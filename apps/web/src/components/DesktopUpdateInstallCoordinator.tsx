import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useSyncExternalStore } from "react";
import { environmentCatalog } from "../connection/catalog";
import { isElectron } from "../env";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { createDesktopUpdateIdleAtom } from "../state/desktopUpdateIdle";
import { desktopUpdateInstall } from "../state/desktopUpdateInstall";
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
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

function ScheduledRestart() {
  const idle = useAtomValue(idleAtom);
  const registry = useContext(RegistryContext);
  const update = useDesktopUpdateState();
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !update) return;
    void desktopUpdateInstall.tryInstall(
      bridge,
      () => idle && registry.get(idleAtom),
      (description) => {
        toastManager.add({ type: "error", title: "Automatic restart cancelled", description });
      },
    );
  }, [idle, registry, update]);
  return null;
}

export function DesktopUpdateInstallCoordinator() {
  const state = useSyncExternalStore(
    desktopUpdateInstall.subscribe,
    desktopUpdateInstall.getSnapshot,
    desktopUpdateInstall.getSnapshot,
  );
  useEffect(() => () => desktopUpdateInstall.cancel(), []);
  if (!isElectron) return null;
  return (
    <>
      {state.status === "waiting" ? <ScheduledRestart /> : null}
      {state.status === "waiting" || state.status === "installing" ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          <span>
            {state.status === "installing"
              ? "Restarting to install update…"
              : `Update ${state.version} will install when threads finish. Keep this window open.`}
          </span>
          {state.status === "waiting" ? (
            <Button variant="outline" size="sm" onClick={desktopUpdateInstall.cancel}>
              Cancel restart
            </Button>
          ) : null}
        </div>
      ) : null}
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
