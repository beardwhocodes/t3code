# Forking Threads

Forking makes a second thread that starts where an existing thread is now. The new thread opens
with the same conversation, and the agent still remembers it. Fork a thread when it reaches a good
point and you want to try two directions from it without giving either one up.

The thread you fork is the parent. The new thread is the fork. After that they are two ordinary
threads: each has its own title, its own turns, and its own history. Work in one never changes the
conversation in the other.

This is a fork, not a branch. A thread already has a Git branch, and the two are different things.

## Making a Fork

Fork sits with a thread's other actions, next to Archive: open the thread's menu in the thread
list, or long-press the thread on mobile. T3 Code asks one question, where the fork should do its
file work, and then opens the new thread.

The fork opens idle. Nothing runs until you send the first message. That message is when the agent
picks the parent's conversation up and continues from it.

## What Carries Over

- **The conversation.** Every message, activity, and plan from the parent, up to its last completed
  turn.
- **The agent's memory.** The fork's agent session is seeded from the parent's session, so the
  agent knows what it already did and why. You do not have to explain the work again.

A fork is taken at the parent's last completed turn, and it stays in the parent's project. Anything
the parent does after you fork stays in the parent, and nothing the fork does appears in the
parent's conversation.

## Choosing a Workspace

Every fork asks where its file work happens. Choose one of two options.

**Give the fork a new worktree.** The fork gets its own directory, seeded from the parent's current
working state, uncommitted changes included. The two threads then edit different files on disk, and
each one keeps its own branch, its own pull request, and its own version control status. Choose
this when the two directions must not disturb each other.

**Share the parent's worktree.** Both threads edit one directory. If the parent has no worktree of
its own, both threads work in the project directory. Sharing has consequences worth knowing before
you pick it:

- The two threads share one branch, one pull request, and one version control status.
- Each thread's per-turn file diff includes the other thread's edits, because the diff describes
  the directory and not the thread.
- T3 Code refuses to revert a turn while another thread shares the worktree. A revert would throw
  away the other thread's uncommitted work.

Choose sharing when the two threads work on one change together, such as one thread that writes
and one that reviews.

## Which Providers Can Fork

Codex, Claude, and OpenCode fork today.

Cursor and Grok cannot fork yet. Their agent protocol describes the capability, but neither CLI
implements it, so T3 Code hides the action for those providers. T3 Code reads the capability from
the provider on each connection, so the action appears on its own after a CLI release adds it.

## When You Do Not See Fork

T3 Code hides Fork instead of offering an action that would fail. Fork is hidden when:

- the thread's provider cannot fork, as above
- the machine running T3 Code runs an older server that does not know how to fork — see
  [Keeping T3 Code in Sync](./updating.md)
- the thread never started an agent session
- a turn is running, in which case wait for it to finish
- the thread is archived or deleted

If the agent never wrote anything T3 Code can carry over, Fork is offered but the fork
reports that there is no conversation to seed from. That check happens on the machine
running T3 Code, because only it can see the agent's stored session.
