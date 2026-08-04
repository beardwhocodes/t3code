import type { EnvironmentId, ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, GitForkIcon } from "lucide-react";
import { useMemo } from "react";

import { shortcutLabelForCommand } from "~/keybindings";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { selectThreadForks } from "~/threadFork";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";

interface ThreadActionsMenuProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** False under version skew or on a provider instance that cannot seed a
      session from an existing one. */
  readonly canFork: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onFork: () => void;
}

/**
 * Thread actions for the open thread, and the parent side of fork lineage.
 *
 * Owns the shell-list subscription itself rather than taking the fork list as a
 * prop: nothing records a child list on the parent, so the only way to find
 * forks is to filter every shell, and doing that in ChatView would re-render
 * the whole chat on every thread event in every environment.
 */
export function ThreadActionsMenu({
  environmentId,
  threadId,
  canFork,
  keybindings,
  onFork,
}: ThreadActionsMenuProps) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const forks = useMemo(() => selectThreadForks(threads, threadId), [threadId, threads]);
  const forkShortcutLabel = shortcutLabelForCommand(keybindings, "thread.fork");

  if (!canFork && forks.length === 0) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={
              forks.length > 0
                ? `Thread actions, ${forks.length} ${forks.length === 1 ? "fork" : "forks"}`
                : "Thread actions"
            }
            size={forks.length > 0 ? "xs" : "icon-xs"}
            variant="ghost"
          />
        }
      >
        {/* The trigger doubles as the parent-side lineage affordance: a bare
            ellipsis normally, a fork count once this thread has forks. */}
        {forks.length > 0 ? (
          <>
            <GitForkIcon aria-hidden className="size-3.5" />
            <span className="tabular-nums">{forks.length}</span>
          </>
        ) : (
          <EllipsisIcon aria-hidden className="size-4" />
        )}
      </MenuTrigger>
      <MenuPopup align="end" className="max-w-72">
        {canFork ? (
          <MenuItem onClick={onFork}>
            <GitForkIcon />
            Fork thread
            {forkShortcutLabel ? <MenuShortcut>{forkShortcutLabel}</MenuShortcut> : null}
          </MenuItem>
        ) : null}
        {forks.length > 0 ? (
          <>
            {canFork ? <MenuSeparator /> : null}
            <MenuGroupLabel>Forks of this thread</MenuGroupLabel>
            {forks.map((fork) => (
              <MenuItem
                key={fork.id}
                onClick={() => {
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(scopeThreadRef(environmentId, fork.id)),
                  });
                }}
              >
                <GitForkIcon />
                <span className="min-w-0 truncate">{fork.title}</span>
              </MenuItem>
            ))}
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
