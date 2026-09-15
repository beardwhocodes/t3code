import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createDesktopUpdateInstallController } from "./desktopUpdateInstall";

const update: DesktopUpdateState = {
  enabled: true,
  status: "downloaded",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "1.1.0",
  downloadedVersion: "1.1.0",
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: 100,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const controller = createDesktopUpdateInstallController();
  const bridge = {
    getUpdateState: vi.fn(async () => update),
    installUpdate: vi.fn(async (): Promise<DesktopUpdateActionResult> => ({
      accepted: true,
      completed: false,
      state: update,
    })),
  };
  const onError = vi.fn();
  const schedule = async () => {
    const confirmation = controller.request(update);
    controller.respond("when-idle");
    expect(await confirmation).toBe(false);
  };
  return { controller, bridge, onError, schedule };
}

describe("scheduled desktop restart", () => {
  it("keeps immediate restart opt-in and dismissing does not install", async () => {
    const { controller, bridge } = harness();
    const first = controller.request(update);
    controller.respond("cancel");
    expect(await first).toBe(false);
    const second = controller.request(update);
    controller.respond("now");
    expect(await second).toBe(true);
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });
  it("waits for idle and installs only once", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    await controller.tryInstall(
      bridge,
      () => false,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    await Promise.all([
      controller.tryInstall(
        bridge,
        () => true,
        onError,
        async () => true,
      ),
      controller.tryInstall(
        bridge,
        () => true,
        onError,
        async () => true,
      ),
    ]);
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });
  it("rechecks live activity after reading the updater", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    let idle = true;
    bridge.getUpdateState.mockImplementation(async () => {
      idle = false;
      return update;
    });
    await controller.tryInstall(
      bridge,
      () => idle,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });
  it("honors cancellation while the updater read is in flight", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    bridge.getUpdateState.mockImplementation(async () => {
      controller.cancel();
      return update;
    });
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("idle");
  });
  it("does not silently install a different downloaded version", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    bridge.getUpdateState.mockResolvedValue({ ...update, downloadedVersion: "1.2.0" });
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe("idle");
  });
  it.each(["rejected", "failed", "throw"])(
    "cancels a %s install without retrying",
    async (failure) => {
      const { controller, bridge, onError, schedule } = harness();
      await schedule();
      if (failure === "throw") bridge.installUpdate.mockRejectedValue(new Error("IPC failed"));
      else
        bridge.installUpdate.mockResolvedValue({
          accepted: failure !== "rejected",
          completed: false,
          state:
            failure === "failed" ? { ...update, status: "error", errorContext: "install" } : update,
        });
      await controller.tryInstall(
        bridge,
        () => true,
        onError,
        async () => true,
      );
      await controller.tryInstall(
        bridge,
        () => true,
        onError,
        async () => true,
      );
      expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledOnce();
      expect(controller.getSnapshot().status).toBe("idle");
    },
  );
  it("keeps waiting through a background update check", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    bridge.getUpdateState.mockResolvedValue({ ...update, status: "checking" });
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(controller.getSnapshot().status).toBe("waiting");
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    bridge.getUpdateState.mockResolvedValue(update);
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
  it("recovers from a native error after installation was accepted", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(controller.getSnapshot().status).toBe("installing");
    controller.observeUpdate(
      { ...update, status: "error", errorContext: "install", message: "Native installer refused" },
      onError,
    );
    expect(controller.getSnapshot().status).toBe("idle");
    expect(onError).toHaveBeenCalledWith("Native installer refused");
    const retry = controller.request(update);
    expect(controller.getSnapshot().status).toBe("confirming");
    controller.respond("cancel");
    await retry;
  });
  it("waits for server finalization and honors cancellation during it", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    const entered = deferred<void>();
    const finished = deferred<boolean>();
    const installing = controller.tryInstall(
      bridge,
      () => true,
      onError,
      () => {
        entered.resolve();
        return finished.promise;
      },
    );
    await entered.promise;
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    controller.cancel();
    finished.resolve(true);
    await installing;
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });
  it("does not install when the server finds more work", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => false,
    );
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("waiting");
    await controller.tryInstall(
      bridge,
      () => true,
      onError,
      async () => true,
    );
    expect(bridge.installUpdate).toHaveBeenCalledWith({ expectedVersion: "1.1.0" });
  });
  it("rechecks server readiness if a native update check wins admission", async () => {
    const { controller, bridge, onError, schedule } = harness();
    await schedule();
    const prepare = vi.fn(async () => true);
    bridge.installUpdate.mockResolvedValueOnce({
      accepted: false,
      completed: false,
      state: { ...update, status: "checking" },
    });
    await controller.tryInstall(bridge, () => true, onError, prepare);
    expect(controller.getSnapshot().status).toBe("waiting");
    expect(onError).not.toHaveBeenCalled();
    await controller.tryInstall(bridge, () => true, onError, prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe("installing");
  });
  it("does not replace an existing confirmation", async () => {
    const { controller } = harness();
    const original = controller.request(update);
    expect(await controller.request(update)).toBe(false);
    controller.cancel();
    expect(await original).toBe(false);
  });
});
