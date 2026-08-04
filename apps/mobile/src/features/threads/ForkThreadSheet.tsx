import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { THREAD_FORK_WORKTREE_CHOICES } from "@t3tools/client-runtime/state/thread-fork";
import { EnvironmentId, ThreadId, type ThreadForkWorktreeMode } from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { useThreadShell } from "../../state/entities";
import { useThreadListActions } from "../home/useThreadListActions";
import { SheetActionButton } from "./git/gitSheetComponents";

type ForkThreadSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

const CHOICE_ICON: Record<ThreadForkWorktreeMode, "arrow.branch" | "folder"> = {
  new: "arrow.branch",
  shared: "folder",
};

export function ForkThreadSheet(props: ForkThreadSheetProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [forking, setForking] = useState(false);

  const params = props.route.params;
  const threadRef = useMemo(
    () =>
      params.environmentId && params.threadId
        ? scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId))
        : null,
    [params.environmentId, params.threadId],
  );
  const thread = useThreadShell(threadRef);
  const { forkThread } = useThreadListActions();

  // Sharing a worktree only means something when there is one. A thread rooted
  // at the project directory has nothing to share, so the choice collapses to
  // the single "new worktree" answer.
  const choices = THREAD_FORK_WORKTREE_CHOICES.filter(
    (choice) => choice.mode === "new" || thread?.worktreePath != null,
  );

  const runFork = useCallback(
    async (worktree: ThreadForkWorktreeMode) => {
      if (thread === null || forking) return;
      setForking(true);
      const forkedThreadId = await forkThread(thread, worktree);
      setForking(false);
      if (forkedThreadId === null) {
        return;
      }
      // Replace only after the command resolves: the fork's id is minted
      // client-side, so navigating optimistically would land on
      // ThreadUnavailableScreen until the shell event catches up.
      navigation.dispatch(
        StackActions.replace("Thread", {
          environmentId: String(thread.environmentId),
          threadId: String(forkedThreadId),
        }),
      );
    },
    [forkThread, forking, navigation, thread],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title="Fork thread" onBack={() => navigation.goBack()} />
      ) : (
        <View className="min-h-4 pt-2" />
      )}

      <View className="items-center gap-1 px-5 pb-3 pt-4">
        <Text className="text-xs font-t3-bold tracking-[1px] uppercase text-foreground-muted">
          Fork
        </Text>
        <Text className="text-center text-3xl font-t3-bold">Fork this thread?</Text>
        <Text className="text-center text-foreground-secondary text-sm font-medium leading-normal">
          The new thread starts with this conversation and the agent's memory, so you can take the
          work in two directions.
        </Text>
      </View>

      <View className="gap-3 px-5 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 18) + 8 }}>
        {choices.map((choice) => (
          <View key={choice.mode} className="gap-1.5">
            <SheetActionButton
              disabled={thread === null || forking}
              icon={CHOICE_ICON[choice.mode]}
              label={choice.label}
              tone={choice.mode === "new" ? "primary" : "secondary"}
              onPress={() => void runFork(choice.mode)}
            />
            <Text className="text-center text-xs leading-snug text-foreground-muted">
              {choice.description}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
