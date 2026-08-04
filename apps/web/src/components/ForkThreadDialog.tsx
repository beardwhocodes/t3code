"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { THREAD_FORK_WORKTREE_CHOICES } from "@t3tools/client-runtime/state/thread-fork";
import type { ScopedThreadRef, ThreadForkWorktreeMode } from "@t3tools/contracts";
import { CheckIcon, FolderGit2Icon, GitForkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useThreadActions } from "~/hooks/useThreadActions";
import { readEnvironmentThreadRefs, readThreadShell, useThreadShell } from "~/state/entities";
import { buildForkThreadTitle, selectThreadForks } from "~/threadFork";
import { formatWorktreePathForDisplay } from "~/worktreeCleanup";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { RadioGroup } from "./ui/radio-group";
import { stackedThreadToast, toastManager } from "./ui/toast";

const WORKSPACE_CARD_CLASS =
  "relative flex cursor-pointer items-start gap-3 rounded-lg bg-card px-3 py-3 text-left outline-none ring-1 ring-black/5 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary/8 data-checked:ring-2 data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15";

/**
 * The fork's default title, read once when the dialog mounts. A one-shot read
 * of the sibling shells rather than a subscription: the dialog would otherwise
 * re-render on every thread update in every environment just to name one fork.
 */
function readDefaultForkTitle(threadRef: ScopedThreadRef): string {
  const siblings = readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
    const shell = readThreadShell(ref);
    return shell === null ? [] : [shell];
  });
  return buildForkThreadTitle({
    parentTitle: readThreadShell(threadRef)?.title ?? "Thread",
    siblingTitles: selectThreadForks(siblings, threadRef.threadId).map((fork) => fork.title),
  });
}

interface ForkThreadDialogProps {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Fork confirmation for one thread: name the fork and choose its workspace.
 * Mounted only while a fork is being set up, so its host must key it by thread
 * to reset the draft title between forks.
 */
export function ForkThreadDialog({ threadRef, onOpenChange }: ForkThreadDialogProps) {
  const { forkThread } = useThreadActions();
  const parent = useThreadShell(threadRef);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(() => readDefaultForkTitle(threadRef));
  const [worktree, setWorktree] = useState<ThreadForkWorktreeMode>("new");
  const [isForking, setIsForking] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !isForking && parent !== null;
  // Nothing to share when the parent runs in the project root: offering the
  // choice would be a no-op with a misleading label. "shared" is still the
  // right mode to send — it means "the parent's workspace", which is the
  // project root here, and "new" would silently give the fork a worktree the
  // parent never had.
  const parentWorktreePath = parent?.worktreePath ?? null;
  const effectiveWorktree: ThreadForkWorktreeMode =
    parentWorktreePath === null ? "shared" : worktree;

  const submit = () => {
    if (!canSubmit) return;
    setIsForking(true);
    void (async () => {
      const result = await forkThread(threadRef, {
        title: trimmedTitle,
        worktree: effectiveWorktree,
      });
      setIsForking(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not fork thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      onOpenChange(false);
    })();
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!isForking) onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitForkIcon className="size-4" />
            Fork thread
          </DialogTitle>
          <DialogDescription>
            The fork opens with this thread's conversation and the agent's memory of it. From there
            the two continue apart.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Fork title</span>
            <Input
              ref={titleInputRef}
              aria-label="Fork title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submit();
              }}
            />
          </label>

          <div className="grid gap-2">
            <span id="fork-workspace-label" className="text-xs font-medium text-foreground">
              Workspace
            </span>
            {parentWorktreePath === null ? (
              <p className="text-[11px] text-muted-foreground">
                This thread runs in the project root, so the fork does too.
              </p>
            ) : (
              <RadioGroup
                value={worktree}
                onValueChange={(value) => setWorktree(value as ThreadForkWorktreeMode)}
                aria-labelledby="fork-workspace-label"
                className="grid grid-cols-1 gap-2"
              >
                {THREAD_FORK_WORKTREE_CHOICES.map((choice) => (
                  <RadioPrimitive.Root
                    key={choice.mode}
                    value={choice.mode}
                    className={WORKSPACE_CARD_CLASS}
                  >
                    <FolderGit2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {choice.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {choice.description}
                        {/* Named consequences, not just "same files": a shared
                            worktree also merges the two threads' per-turn diffs
                            and gives them one branch and one pull request. */}
                        {choice.mode === "shared" ? (
                          <>
                            {" "}
                            Both threads edit{" "}
                            <span className="font-mono">
                              {formatWorktreePathForDisplay(parentWorktreePath)}
                            </span>
                            , so each turn's file diff includes the other's edits, and they share
                            one branch and one pull request.
                          </>
                        ) : null}
                      </span>
                    </span>
                    <RadioPrimitive.Indicator
                      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                      aria-hidden
                    >
                      <CheckIcon className="size-3.5 shrink-0" />
                    </RadioPrimitive.Indicator>
                  </RadioPrimitive.Root>
                ))}
              </RadioGroup>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isForking}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
            {isForking ? "Forking..." : "Fork thread"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
