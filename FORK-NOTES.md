# Fork threads — fork notes and known issues

This is a **fork** of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) carrying one feature
that upstream does not have: **forking a thread**. From an existing thread you can create a new one
that keeps the same conversation and the same agent memory, so you can take one thread in two
directions without giving either up.

It is shared as-is, for people who want the feature now. It is not a proposal to upstream.

## Read this before using it

**Upstream is building this themselves, differently.** Pull request
[pingdotgg/t3code#2829](https://github.com/pingdotgg/t3code/pull/2829) ("introduce new orchestrator",
812 files) replaces the orchestration layer this feature is built on, and its design doc
`.plans/19-thread-lineage-context-transfer.md` covers forking as one case of a general
context-transfer primitive — with fork-from-any-past-point, provider handoff, and merge-back.
This fork targets the layer that PR removes. Expect it to be superseded.

**Upstream is not accepting contributions.** `CONTRIBUTING.md` says so plainly, and says large
feature PRs will likely be closed. Nothing here was submitted upstream, and it should not be.

## What works

- Fork from the sidebar row menu (both sidebars), the chat header menu, the command palette, and
  `mod+alt+f`; on mobile from the thread-row long-press menu and the composer menu.
- The fork copies the source's messages, activities and proposed plans, and seeds its provider
  session lazily on its first turn — Codex `thread/fork` pinned to the recorded tip, Claude
  `resume` + `forkSession`, OpenCode `session.fork`.
- Cursor and Grok are hidden: their protocol describes fork support but neither CLI implements it.
- Lineage shows in the transcript as a seam where inherited history ends, plus fork indicators in
  every list surface and a "Forks (n)" list on the parent.
- Choose a new worktree (seeded from the parent's working state, uncommitted work included) or
  share the parent's.

See [`docs/user/forking-threads.md`](docs/user/forking-threads.md).

## Known issues

Found by a multi-lens review of the feature commit, with each finding independently
verified before being recorded. Two data-loss blockers and three majors found by that review are
already fixed in `fix: keep forked threads intact through revert and workspace failures`. What
follows is what is **still open**, newest analysis first. Severity is the reviewer's, after
verification.

Counts: **8 major**, **24 minor**.

### Major

**Wrong shape for this repo: a 3,905-line, 88-file net-new feature in one commit, with no issue first**

A maintainer closes this on the stat line alone. The work is good and would still be rejected
unread, which wastes the whole effort and, per CONTRIBUTING.md:35, damages the contributor's
standing.

- Evidence: git diff main...HEAD --stat: 88 files, +3905 -94 in a single commit 575eb063b; 13 new files.
  Against CONTRIBUTING.md:5 ("We are not actively accepting contributions right now"), :17-23
  (most likely: small focused bug/reliability/perf fixes), :27-35 (least likely: large PRs,
  drive-by feature work, "anything that expands product scope without us asking for it first";
  "If you open a 1,000+ line PR full of new features, we will probably close it quickly"), :39
  ("Keep it small"), :55 ("If you are thinking about a non-trivial change, open an issue
  first").

- Fix: Do not open this as an unsolicited PR. Open an issue that states the feature, the event-
  shape argument (fork as `thread.create` + `forkedFrom`, not a new event type), and the size,
  and get explicit maintainer buy-in. If they sanction it, ship it as a sequence of PRs with
  these seams, each independently reviewable: (1) the revert-on-shared-worktree guard,
  standalone with tests — it is not fork-specific (CheckpointReactor.ts:726-747); (2)
  contracts + server core: packages/contracts (+112), packages/shared (+3), decider.ts,
  ProjectionPipeline.ts, forkRowIds.ts, migration 036, ProjectionThreads\*,
  ProviderAdapter/ProviderService and the five adapters, ws.ts, plus docs/internals — the
  feature is dispatchable and tested with no UI; (3) web UI + packages/client-
  runtime/src/state/threadFork.ts (+1,202/+396) with before/after images; (4) mobile UI (+413)
  with images. Steps 3 and 4 are the natural split because neither client's code is imported
  by the other.

**Two backend behavior changes ship without focused tests**

Both changes are silent when wrong. A regression in the retention set deletes image files that
forks still render, with no error anywhere; a regression in the guard either blocks every revert
or blocks none.

- Evidence: AGENTS.md:108: "Backend behavior changes ship with focused tests for that behavior." The
  revert refusal (CheckpointReactor.ts:726-747) has none — the only change to
  CheckpointReactor.test.ts is a `threadFork: "unsupported"` field on the harness capability
  literal. The attachment-retention change (ProjectionPipeline.ts:404-424,
  ProjectionThreads.ts:201-212 `listForkThreadIds`) has none either: the sole test added to
  ProjectionPipeline.test.ts is "copies a forked thread's history without stealing the
  source's rows", while the neighbouring "removes thread attachment directory when thread is
  deleted" test — the exact behavior that was changed — was left untouched.

- Fix: Add an it.effect to CheckpointReactor.test.ts asserting the refusal activity when a sibling
  shares the workspace and a normal revert when it does not. Extend the existing delete-
  attachments test in ProjectionPipeline.test.ts with a fork that still references the deleted
  thread's attachment ids, asserting those files survive.

**Web and mobile behave differently for the same fork: title and project-root workspace**

The same action on the same thread produces a different on-disk result and a different thread
list depending on which client the user reached for. Mobile-created forks are also
unidentifiable in the sidebar the web user is looking at.

- Evidence: Title: web applies buildForkThreadTitle (apps/web/src/threadFork.ts:19-31, used at
  ForkThreadDialog.tsx:44-47) whose own doc says an inherited title "leaves two identical rows
  in every list forever"; mobile calls buildThreadForkCreateInput with no title override
  (useThreadListActions.ts:266-273), and buildThreadForkCreateInput copies `title:
input.source.title` verbatim (packages/client-runtime/src/state/threadFork.ts:139), so every
  mobile fork produces a duplicate row. Workspace: when the parent has no worktree, web forces
  `"shared"` (ForkThreadDialog.tsx:83-85, "'new' would silently give the fork a worktree the
  parent never had"), while mobile filters the choice list to `"new"` only
  (ForkThreadSheet.tsx:44-46) — the inverse, and it creates a worktree on disk. Against
  AGENTS.md:70 ("Clients... Shared logic lives in packages/client-runtime") and the module's
  own claim at packages/client-runtime/src/state/threadFork.ts:96-100 that the workspace
  question is "worded once so web and mobile describe the same tradeoff".

- Fix: Move buildForkThreadTitle (and selectThreadForks, which mobile will want for the same
  reason) into packages/client-runtime/src/state/threadFork.ts beside
  buildThreadForkCreateInput, and have buildThreadForkCreateInput default the title through it
  so no caller can forget. Make the project-root case identical on both clients — pick web's
  `"shared"` semantics and drop mobile's filter, or offer both modes everywhere.

**Nothing anywhere proves a fork seeds a provider session**

The feature is "same history AND same agent memory". The history half has a real test; the
memory half has none at any layer. Delete `...(forkSource && input?.resumeCursor === undefined ?
{ forkFrom: forkSource } : {})` at ProviderCommandReactor.ts:608 and the entire suite stays
green while every fork silently starts an empty agent that renders a full transcript it has no
memory of — the exact failure the CodexSessionRuntime.ts:487 comment says a visible error is
preferable to. The one-shot property (a restart must resume, not re-fork and discard the fork's
work) is equally unpinned.

- Evidence: Implementation: apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:582 (lineage
  walk, one-shot gate at :608), apps/server/src/provider/Layers/ProviderService.ts:601 (cursor
  resolution + two refusals), apps/server/src/provider/Layers/CodexSessionRuntime.ts:497
  (thread/fork), apps/server/src/provider/Layers/ClaudeAdapter.ts:3568 (resume + forkSession),
  apps/server/src/provider/Layers/OpenCodeAdapter.ts:1248 (session.fork). Tests:
  apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts:148 and :321 add a
  `threadFork` harness option that no test case ever passes;
  apps/server/src/provider/Layers/ProviderService.test.ts:206 only widens a capability
  literal; ClaudeAdapter.test.ts, OpenCodeAdapter.test.ts and CodexAdapter.test.ts are
  untouched; apps/server/src/provider/Layers/CodexSessionRuntime.test.ts:428,:468 only add
  `forkFrom: undefined` to existing calls.
  apps/server/integration/TestProviderAdapter.integration.ts:495 advertises `threadFork:
"provider-session"` but apps/server/integration/orchestrationEngine.integration.test.ts adds
  no fork case.

- Fix: Add one integration case in apps/server/integration/orchestrationEngine.integration.test.ts:
  run a turn on a source thread, dispatch a `thread.create` carrying `forkedFrom`, drain,
  start a turn on the fork, and assert the test adapter's `startSession` received `forkFrom`
  with the SOURCE's `resumeCursor`; then start a second turn and assert `forkFrom` is absent.
  Add unit cases where harnesses already exist: CodexSessionRuntime.test.ts `openCodexThread`
  (fake client already injected) asserting method `thread/fork`, `lastTurnId` forwarded,
  `ephemeral` dropped, and that a fork failure does NOT fall back to `thread/start`;
  ClaudeAdapter.test.ts (query-options harness already used at :417) asserting `resume:
parentSessionId` + `forkSession: true` + a fresh `sessionId`, and that the returned cursor
  has `turnCount: 0` and no `resumeSessionAt`. Add ProviderService.test.ts cases for the two
  refusals (`threadFork: "unsupported"`, source binding with no cursor) and for `resumeCursor`
  winning over `forkFrom`.

**The fork dispatch path in ws.ts is entirely untested, including its compensation**

This is the only layer that refuses a fork the provider cannot honour and the only layer that
cleans up after a half-built fork. If the compensation stops running, every failed fork leaves
an orphan worktree and branch on the user's disk; if the capability check regresses, the server
accepts forks it cannot seed. server.test.ts already builds the full RPC app with mockable
CheckpointStore/GitWorkflow/ProjectionSnapshotQuery layers, so the cost of covering this is low
and the absence reads as an oversight.

- Evidence: apps/server/src/ws.ts:976-1128 (`dispatchThreadForkCreate`: provider-capability refusal,
  new-worktree branch with captureCheckpoint→createWorktree→restoreCheckpoint,
  `removeCreatedWorktree` compensation, shared-worktree inheritance).
  apps/server/src/server.test.ts:751-781 only adds a `CheckpointStore` mock so the existing
  suite still builds; `grep -i fork apps/server/src/server.test.ts` finds only
  `Effect.forkChild`/`forkScoped`.

- Fix: Add three server.test.ts cases through the RPC boundary: (a) source provider without
  `supportsThreadFork` → dispatch never reached, error returned; (b) `worktree: "new"` happy
  path asserting captureCheckpoint, createWorktree, restoreCheckpoint fired in order and that
  the dispatched command carries the created `worktreePath`/`branch`; (c) engine dispatch
  failure → `removeWorktree` called with `force: true`.

**The shared-worktree revert refusal — a data-loss guard — has no test**

The design names this as the guard that stops a fork's revert from running `git restore` + `git
clean -fd` over a sibling thread's worktree and destroying its uncommitted and untracked files.
Forking makes a shared worktree a one-click choice, so this path is now reachable by ordinary
use. Remove the block and every existing test passes.

- Evidence: apps/server/src/orchestration/Layers/CheckpointReactor.ts:726-746 (finds another live thread
  on the same `worktreePath`, appends a failure activity, returns before restore).
  apps/server/src/orchestration/Layers/CheckpointReactor.test.ts:113 is the only change to
  that file — a capability literal.

- Fix: Add one CheckpointReactor.test.ts case: two threads projected onto the same `worktreePath`,
  dispatch a revert on one, drain the reactor, assert `restoreCheckpoint` was never called and
  that the refusal activity naming the sibling was appended. The mirror guard at
  ProviderCommandReactor.ts:793 (skip branch rename on a shared worktree) deserves the same
  treatment in its own test file.

**The attachment-ownership change is unproven; the existing deletion test passes without it**

Revert the carve-out and the suite is green while deleting a parent thread blanks out every
image still rendered by its forks — silent, on threads the user never touched, exactly the
failure the code comment describes. The new query is also the only consumer of the migration's
index, so nothing exercises it either.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:404-421 (`listForkThreadIds` →
  `referencedElsewhere` → keep set) and :380 (the `keepAttachmentIds.has` early return). The
  nearest test, apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts:998 ("removes
  thread attachment directory when thread is deleted"), predates the commit and was not
  extended; no new test creates a fork before deleting a thread.

- Fix: Extend the test at ProjectionPipeline.test.ts:998: project a fork whose copied message
  references the parent's attachment id, delete the parent, then assert the referenced file
  still exists while an unreferenced attachment of the same parent is removed.

**Docs and the contract promise per-connection ACP fork discovery that does not exist**

All three places tell the reader the flag is discovered from the agent's advertised capabilities
per connection and "can flip after a CLI upgrade without a change here". No such discovery is
implemented. The user-facing sentence ("the action appears on its own after a CLI release adds
it") is a promise to users that will never come true, and the internals doc will send the next
contributor looking for a probe that does not exist.

- Evidence: docs/internals/providers.md:67-69; docs/user/forking-threads.md:59-61;
  packages/contracts/src/server.ts:177-178. Contradicted by
  apps/server/src/provider/Layers/CursorAdapter.ts:1167 and GrokAdapter.ts:1449, which
  hardcode `threadFork: "unsupported"`, and by the fact that `supportsThreadFork` is set only
  at CodexProvider.ts:606, ClaudeProvider.ts:929,954 and OpenCodeProvider.ts:440 — never for
  Cursor or Grok

- Fix: Delete the discovery sentence from all three. In providers.md say Cursor and Grok are
  hardcoded `unsupported` in their adapters and enabling them means editing those adapters
  plus their provider snapshots; in forking-threads.md say Cursor and Grok cannot fork; in
  server.ts:177-178 keep only the absent-means-false rule.

### Minor

**Three docs describe a per-connection ACP fork capability that does not exist**

The user doc tells Cursor and Grok users to wait for a CLI release that will never change
anything, and the internals doc tells the next maintainer no code change is needed when in fact
two adapter literals must be edited. AGENTS.md:75 and :141 both treat docs and comments as part
of the change.

- Evidence: docs/internals/providers.md:68-69 ("For ACP-backed instances the flag is discovered per
  connection, so it can flip after a CLI upgrade without a change here") and
  docs/user/forking-threads.md:59-61 ("T3 Code reads the capability from the provider on each
  connection, so the action appears on its own after a CLI release adds it"). The code
  hardcodes it: CursorAdapter.ts:1167 and GrokAdapter.ts:1449 both return `threadFork:
"unsupported"` as a literal, and `supportsThreadFork` is only ever set in
  CodexProvider.ts:606, ClaudeProvider.ts:929/954 and OpenCodeProvider.ts:440 — nothing reads
  an agent capability from an ACP initialize result (grep for `supportsThreadFork` in
  apps/server/src).

- Fix: Either reword both docs to say the flag is a per-adapter constant that a future change must
  flip, or implement the discovery in CursorAdapter/GrokAdapter from the agent's advertised
  capabilities and keep the wording.

**overview.md and an error message state a fork precondition the shipped gate deliberately rejects**

The internals doc is the thing a maintainer reads to decide whether the client gate is right,
and it describes a gate that is not there. The user-facing error names a precondition that is
never checked, so it will be shown for a different reason than it states.

- Evidence: docs/internals/overview.md:121-124: "one more the decider leaves to them: the source needs
  at least one completed turn... forking a thread that never completed one is rejected by the
  app-server." packages/client-runtime/src/state/threadFork.ts:52-59 says the opposite in
  detail: "It deliberately does NOT require a completed `latestTurn`... gating on it hides the
  action almost everywhere," and canForkThread (:61-79) has no such clause.
  apps/web/src/hooks/useThreadActions.ts ThreadForkBlockedError repeats the wrong rule to the
  user: "It needs a completed turn and no work in flight."

- Fix: Pick one truth. Delete the "at least one completed turn" sentence from overview.md:121-124
  (and adjust the Codex rollout sentence), and reword ThreadForkBlockedError to the conditions
  canForkThread actually enforces: session settled and no running turn.

**Same two services provided twice in one pipe (copy-paste artifact)**

Two dead lines in the hot projection path that a reviewer will read as "did they mean to provide
something else here?". It is pure copy-paste debris in the file the whole fork history copy runs
through.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1767-1770 —
  `Effect.provideService(ProjectionThreadRepository, …)` and
  `Effect.provideService(ProjectionThreadMessageRepository, …)` appear back to back, then
  repeat identically on the next two lines. The correct single pair is at 1785-1786 in the
  sibling bootstrap pipe.

- Fix: Delete lines 1769-1770.

**27-line comment in ProviderCommandReactor is three merged drafts**

AGENTS.md says comments describe how a thing is used and move when the code moves; this is
abandoned partial work left in the file. A maintainer reading it cannot tell which of the three
descriptions is current, and the instance-inheritance paragraph points at code that is not
there.

- Evidence: apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:555-581. Lines 555-560 and
  566-570 say the same thing twice ("a restart therefore resumes the fork instead of re-
  forking the source and discarding whatever the fork has produced since" / "a restart resumes
  the fork rather than re-forking the source and discarding whatever the fork has produced
  since"). Line 571 is a stranded fragment ("Resolve the fork source through the lineage, not
  just one link up.") with no paragraph around it. Lines 562-565 describe provider-instance
  inheritance, which this block does not implement — that happens client-side in
  `buildThreadForkCreateInput` (packages/client-runtime/src/state/threadFork.ts:139).

- Fix: Collapse to one paragraph: the lineage walk and why only the cursor walks (lines 573-581 are
  the good version). Drop the duplicated one-shot sentence and the stranded line 571, and move
  or delete the instance paragraph.

**Identical 8-line rationale pasted verbatim into four switch cases**

AGENTS.md: comments describe how a thing is used, not annotate every branch. Four copies means
four things to update when the reasoning changes, and the turns handler (1187) prepends it to a
_different_ rationale about checkpoint refs, so the reader has to work out that the first eight
lines are boilerplate.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:936-943, 1032-1039, 1100-1107,
  1187-1194 — the same "A fork copies the source thread's history … forcing a full snapshot
  reset on all of their other devices." block appears four times, once per
  `applyThread*Projection` handler. No other rationale in this ~1800-line file is repeated
  even twice.

- Fix: State it once — on `copyThreadHistory` in the repository interfaces, or as a single note
  above the four handlers — and leave a one-line pointer in each case.

**forkedAt column is migrated, written and SELECTed six times, then never read**

A schema column and six query aliases that carry no information the row does not already have —
the pipeline sets `forkedAt: event.payload.createdAt`, which is `created_at`. This is the "no
orphaned partial work" rule: the next reader has to prove it is dead before touching it.

- Evidence: Added by apps/server/src/persistence/Migrations/036_ProjectionThreadsForkedFrom.ts:22-27;
  written at apps/server/src/orchestration/Layers/ProjectionPipeline.ts:652; selected as
  `forked_at AS "forkedAt"` at ProjectionSnapshotQuery.ts:414, 451, 490, 929 and
  ProjectionThreads.ts:152, 189. `mapForkedFrom` (ProjectionSnapshotQuery.ts:270-278) reads
  only `forkedFromThreadId`/`forkedFromTipTurnId`, and `ThreadForkOrigin`
  (packages/contracts/src/orchestration.ts:270-273) has no such field, so it cannot reach a
  client. The one consumer that needs it uses `activeThread.createdAt` instead
  (apps/web/src/components/ChatView.tsx:4264).

- Fix: Either drop `forked_at` from migration 036, the two repositories and the four snapshot
  SELECTs, or finish the wiring: map it in `mapForkedFrom`, add it to `ThreadForkOrigin`, and
  have ChatView read it instead of `createdAt`.

**"Needs at least one completed turn" is documented and shown to users but never checked**

Both the internals doc and the error string were added by this same commit, so the architecture
doc misdescribes the client gate on day one and the user-facing error names a precondition that
was never evaluated. A user hitting `ThreadForkBlockedError` will look for a completed turn that
is irrelevant.

- Evidence: docs/internals/overview.md:122-123 states the client enforces "one more [precondition] the
  decider leaves to them: the source needs at least one completed turn".
  apps/web/src/hooks/useThreadActions.ts:130 tells the user "It needs a completed turn and no
  work in flight." But packages/client-runtime/src/state/threadFork.ts:52-59 documents the
  opposite at length — "It deliberately does NOT require a completed `latestTurn`" — and
  `canForkThread` (threadFork.ts:61-79) has no such clause.

- Fix: Rewrite overview.md:122-124 to match `canForkThread` (the extra precondition is a provider
  conversation, checked server-side in ProviderService.ts:611-616), and change the
  `ThreadForkBlockedError` message to "It may be archived, deleted, or still working."

**Documented ACP per-connection discovery of supportsThreadFork does not exist**

providerSnapshot.ts justifies keeping the field out of `presentation` on a mechanism that was
never built, so the next contributor will look for the probe that corrects it and find nothing.
The doc promises Cursor/Grok forking turns on after a CLI upgrade; it will not.

- Evidence: docs/internals/providers.md:68-69 ("For ACP-backed instances the flag is discovered per
  connection, so it can flip after a CLI upgrade without a change here"),
  packages/contracts/src/server.ts:178-179 and
  apps/server/src/provider/providerSnapshot.ts:220-223 all claim per-connection discovery.
  Every server write of the flag is a hardcoded literal: ClaudeProvider.ts:929, 954;
  CodexProvider.ts:606; OpenCodeProvider.ts:440. Cursor and Grok write nothing and their
  adapters hardcode `threadFork: "unsupported"` (CursorAdapter.ts:1167, GrokAdapter.ts:1449).
  Nothing reads an ACP agent capability.

- Fix: Either say plainly that the flag is a per-driver constant today and that ACP instances opt
  out until someone wires the capability read, or add the ACP capability read in the
  Cursor/Grok probes so the comments become true.

**Fork banner is pushed into a list named parkedThreadItems**

The name now lies about half its contents, and it is the only handle a later reader has for the
banner ordering. Small, but the repo is otherwise careful about one name per thing.

- Evidence: apps/web/src/components/ChatView.tsx:4320-4323 — `const parkedThreadItems =
[...(forkLineageBannerItem === null ? [] : [forkLineageBannerItem]),
...(parkedThreadBannerItem === null ? [] : [parkedThreadBannerItem])];` and the name is then
  used unchanged in both return paths below.

- Fix: Rename to `threadContextBannerItems` (or push the fork item alongside `parkedThreadItems` at
  the call sites rather than folding it in).

**The pipeline fork test skips four of the invariants the design justifies at length**

Turn exclusion is the guard that stops a fork's first revert from deleting the parent's
checkpoint history — the most destructive failure in the feature — and it currently has no
assertion that could fail. Copied `created_at` is what the web fork seam relies on to split
inherited from own work (MessagesTimeline.logic.ts:480), so a copy that stamped fresh timestamps
would move the divider to the top of every fork with no test noticing. The NOT EXISTS guard is
the only thing preventing a duplicated transcript on re-projection.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts:2466-2648. (1) Turn
  exclusion: the fixture appends no turn events at all, so no source turn rows exist to copy,
  and the `latestTurnId: null` assertion at :2645 is satisfied by the explicit literal at
  ProjectionPipeline.ts:636 rather than by the absence of copied rows. (2) Proposed plans:
  `projection_thread_proposed_plans` is never queried, so the `thread.created` case at
  ProjectionPipeline.ts:1104-1116 could be deleted with the suite green. (3) `created_at`
  preservation on copied rows is never asserted (only `message_id` and `text` at :2606-2613).
  (4) `forkedFromTipTurnId` is never exercised — the fixture's `forkedFrom` has no `tipTurnId`
  — and the re-projection guard `AND NOT EXISTS (...)` at ProjectionThreadMessages.ts:180 is
  never hit because the event is projected once.

- Fix: In the same test: append a completed turn to the source before forking, then assert `SELECT
count(*) FROM projection_turns WHERE thread_id = 'fork-child'` is 0; assert the copied
  proposed-plan row exists with a regenerated `plan_id` and the source's plan still belongs to
  the source; assert the copied message's `created_at` equals the source's; give `forkedFrom`
  a `tipTurnId` and assert `forked_from_tip_turn_id`; and call `projectEvent` with the same
  fork event twice, asserting the copied row count stays at one.

**The decider's fork-of-an-unrun-fork allowance is untested while the client asserts the mirror rule**

Drop `&& !source.forkedFrom` and every server test still passes, but the client keeps offering
an action the server now rejects — the user clicks fork on an inherited transcript and gets an
invariant error. The two halves of this rule live in different packages and only the client half
is pinned.

- Evidence: apps/server/src/orchestration/decider.ts:387 (`if (source.session === null &&
!source.forkedFrom)`). apps/server/src/orchestration/decider.fork.test.ts:177 sets `session:
null` with no `forkedFrom` and only asserts the refusal; no test builds a source that is
  itself a fork. packages/client-runtime/src/state/threadFork.test.ts:169-181 explicitly
  asserts the client OFFERS the fork in that case, and ProviderCommandReactor.ts:582-596
  builds a 32-deep lineage walk on the same assumption.

- Fix: Add a decider.fork.test.ts case whose source has `session: null` and `forkedFrom: {
threadId: … }`, asserting `thread.created` is produced. While there, add a case asserting
  the command read model actually carries `forkedFrom` (ProjectionSnapshotQuery.ts
  `getCommandReadModel` is the one per-thread read the new lineage test at
  ProjectionSnapshotQuery.test.ts:1275 does not cover, and the decider branch is vacuous
  without it).

**A threadHasOwnTurns case pins a state the server cannot produce**

The case reads as the core of the function but exercises an unreachable branch; the reachable
behavior it stands in for (`latestTurn === null` on a fresh fork) is never asserted. If the null
path regressed, this test would still pass.

- Evidence: apps/web/src/threadFork.test.ts:68-80 asserts false when the fork's `latestTurn.turnId`
  equals the copied tip. But a fork copies no turn rows (ProjectionPipeline.ts:1191-1211) and
  its `latest_turn_id` is written null (ProjectionPipeline.ts:636), so a fork's `latestTurn`
  is null until it runs a turn of its own.

- Fix: Change the first assertion to `latestTurn: null` — the state a real fresh fork is in — and
  keep one case for the tip-equality branch only if the shell can genuinely report it. Same
  pass over the migration test (036_ProjectionThreadsForkedFrom.test.ts:25): it asserts
  `forked_at`, which is written but never mapped into any DTO, while the web seam actually
  reads `activeThread.createdAt` (ChatView.tsx:4264).

**No invariant that the fork and its source belong to the same project**

`projectId` is client-supplied. A fork command naming project Q with a source in project P
copies P's entire transcript into a Q thread, and the "new worktree" path captures the seed
checkpoint in P's repo while creating and restoring in Q's repo, so the restore silently no-ops
(its cause is swallowed) and the user gets a Q thread showing P's conversation over an unseeded
workspace. The repo already enforces this invariant for proposed plans, so the omission is a gap
rather than a deliberate relaxation.

- Evidence: apps/server/src/orchestration/decider.ts:365-410 validates the source's deletion, archive,
  session and turn state but never compares `command.projectId` with `source.projectId`;
  contrast decider.ts:838-845, which rejects a proposed plan whose source thread is "in a
  different project"; ws.ts:1032-1051 then resolves `sourceCwd` from `command.projectId`'s
  workspaceRoot

- Fix: Add `source.projectId === command.projectId` to the fork invariants in the decider, failing
  with `OrchestrationCommandInvariantError` in the same style as the proposed-plan check.

**Checkpoint capture and restore failures are swallowed with no signal, so a fork can silently start with an unseeded workspace**

The fork's value is that its new worktree reproduces the parent's working state including
uncommitted and untracked files. If the restore fails for any reason (ref unreachable from the
new worktree, dirty index, cross-repo seed ref per the projectId finding), the fork is created
anyway with a clean checkout, the UI shows the parent's full transcript, and the seeded agent
works against files that lack the edits it remembers. Nothing is logged, so neither the user nor
a maintainer can tell it happened.

- Evidence: apps/server/src/ws.ts:1052-1060 (`Effect.catchCause(() => Effect.succeed(false))` on
  `captureCheckpoint`) and ws.ts:1081-1087 (same on `restoreCheckpoint`), neither logging —
  the neighbouring `removeCreatedWorktree` uses `Effect.ignoreCause({ log: true })`

- Fix: Log both causes at warning level with the checkpoint ref and cwd, and append a thread
  activity on the fork when `seeded` is true but the restore failed, so the divergence is
  visible.

**The fork's pending-user-input suppression lasts only until its first message**

The comment states a guarantee the code does not hold. When the source carries an unresolved
user-input request (request opened, turn interrupted, session idle — which passes the decider's
fork invariants), the fork's first user message recomputes the badge to 1, restoring the phantom
"Awaiting Input" state in every list surface and the mobile snooze refusal the comment says was
avoided. The added test asserts the count only immediately after creation, so it cannot catch
this.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:656-666 forces
  `pendingUserInputCount: 0` and comments that the fork "starts clear"; :843-859 calls
  `refreshThreadShellSummary` on `thread.message-sent`, which recomputes the count from all
  activities via `derivePendingUserInputCountFromActivities` (:133-163) over the copied rows,
  including the unresolved `user-input.requested` the new test itself plants
  (ProjectionPipeline.test.ts, "copies a forked thread's history…")

- Fix: Filter copied activities out of the derivation (skip activity ids carrying the `fork:`
  prefix, or count only requests whose turn belongs to this thread), and extend the test to
  append one message to the fork and re-assert the count.

**Copy-paste and dead-data leftovers in the fork plumbing**

The duplicated services are harmless but signal an unreviewed edit; the dead column adds a
migration and five query columns nobody reads; and the ACP claim tells the next maintainer a
discovery mechanism exists when none does — the kind of lying label AGENTS.md calls out.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1767-1770 provides
  `ProjectionThreadRepository` and `ProjectionThreadMessageRepository` twice in one pipe;
  `forked_at` is written (ProjectionPipeline.ts:652), migrated
  (Migrations/036_ProjectionThreadsForkedFrom.ts:24-28) and selected in five queries but never
  read — the timeline uses `activeThread.createdAt`
  (apps/web/src/components/ChatView.tsx:4259-4266); providerSnapshot.ts:218-226 and
  docs/internals/providers.md:63-67 claim `supportsThreadFork` is "discovered per connection"
  for ACP providers, but Cursor and Grok only get a static `threadFork: "unsupported"` literal
  (CursorAdapter.ts, GrokAdapter.ts, one line each) and no probe ever sets the flag

- Fix: Drop the duplicated `provideService` calls; either surface `forkedAt` through
  `mapForkedFrom` and use it for the timeline seam or drop the column from the migration and
  queries; reword the snapshot comment and providers.md to say Cursor and Grok are statically
  unsupported today.

**Duplicated provideService lines in the projection pipeline**

No runtime cost worth measuring — the second pair just rebuilds the context object — but it
reads as a merge artifact in the hottest function in the file, and `projectEvent` runs for every
projector on every event.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1767-1770 provides
  `ProjectionThreadRepository` and `ProjectionThreadMessageRepository` twice each. The
  `bootstrap` pipe below (lines 1785-1786) provides each once.

- Fix: Delete lines 1769-1770.

**Turn-copy comment survived the removal of turn copying and contradicts the code under it**

The header says "A fork copies the source thread's history into its own rows, in one set-based
statement per table" and the very next comment says "A fork deliberately copies NO turn rows". A
reader of the turns projector is told two opposite things in twelve lines, and the four-way
verbatim duplication guarantees the next edit updates one copy. The `case "thread.created":
return;` it guards is also a behavioural no-op — `default: return;` at :1541 already handles it.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1191-1198 (header) immediately
  followed by :1199-1207; the identical eight-line header also appears at :940-947,
  :1036-1043, :1104-1111

- Fix: Delete the pasted header at :1191-1198 outright. Keep the turn-specific rationale but trim
  it to the checkpoint-ref reason, and either delete the no-op `case` (the default already
  covers it) or keep it with only that trimmed comment. For the three real copy sites, keep
  the rationale once (it is already in docs/internals/overview.md) and leave a one-line
  pointer at :1036 and :1104.

**ProviderCommandReactor fork comment claims provider-instance inheritance the code does not do, and repeats itself**

Twenty-nine lines of comment sit over fifteen lines of code. One paragraph ("Only applies while
this thread has no live session of its own, which is what makes the fork intent one-shot — a
restart resumes the fork rather than re-forking the source") is a near-verbatim repeat of the
opening paragraph. Worse, "The source's provider INSTANCE is inherited, not the user's currently
selected one" and "ProviderService … looks the source's cursor and instance up itself" are both
false: nothing reads the source's instance anywhere. A maintainer reading this will believe a
cross-instance fork is protected. It is not — forking and then switching the fork's model to
another instance either hard-fails at ProviderService.ts:605-609 or resumes a rollout that does
not exist under that instance's CODEX_HOME.

- Evidence: apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:555-583 (comment) over
  :584-598 (code); contradicted by :604 `providerInstanceId: desiredInstanceId` and
  apps/server/src/provider/Layers/ProviderService.ts:617-626, which resolves only
  `resumeCursor` from the source binding

- Fix: Cut :562-572 (the instance-inheritance paragraph and the duplicated one-shot paragraph)
  entirely. Keep the opening one-shot paragraph and the lineage-walk paragraphs, which do
  describe the code. If instance inheritance is actually wanted, that is a separate change to
  :604, not a comment.

**`forked_at` is written, selected five times, and never read**

A migration column is effectively permanent — every future reader of `projection_threads`
carries it. It duplicates `created_at` (it is set to `event.payload.createdAt` at
ProjectionPipeline.ts:652) and the client already derives the identical value client-side at
apps/web/src/components/ChatView.tsx:4264 (`forkedAt: activeThread.createdAt`). It is pure
ballast that also makes five SELECT lists longer than they need to be.

- Evidence: apps/server/src/persistence/Migrations/036_ProjectionThreadsForkedFrom.ts:24-29; write at
  apps/server/src/persistence/Layers/ProjectionThreads.ts:55,83,117; schema field at
  apps/server/src/persistence/Services/ProjectionThreads.ts:49; SELECT aliases at
  ProjectionThreads.ts:152,189 and
  apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:414,451,490,929; the mapper
  at ProjectionSnapshotQuery.ts:268-277 ignores it and no `row.forkedAt` read exists anywhere
  on the server

- Fix: Delete the `forked_at` ADD COLUMN from migration 036, the write at ProjectionThreads.ts:83
  and the COALESCE at :117, the column name at :55, the schema field at
  Services/ProjectionThreads.ts:49, and the six SELECT aliases. Nothing else changes; the
  timeline seam keeps using `thread.createdAt`.

**Mobile forks inherit the parent's title verbatim, which is exactly what the web helper exists to prevent**

The helper's own comment states the failure mode and that neither title regeneration nor the
temporary-branch rename ever fires on a fork, so the duplicate titles are permanent. Mobile
ships that failure mode on both list surfaces, which already need the fork glyph added at
thread-list-items.tsx:490-497 precisely because forked rows are otherwise indistinguishable.
This is the duplication-that-should-have-gone-into-client-runtime case: the shared package owns
the payload builder and the workspace wording but not the one rule that makes the result
readable.

- Evidence: apps/web/src/threadFork.ts:12-31 (`buildForkThreadTitle`, whose doc says a verbatim
  inherited title "leaves two identical rows in every list forever"); mobile calls
  apps/mobile/src/features/home/useThreadListActions.ts:268-273 with no title override, so
  packages/client-runtime/src/state/threadFork.ts:139 `title: input.source.title` stands

- Fix: Move `buildForkThreadTitle` and `selectThreadForks` from apps/web/src/threadFork.ts into
  packages/client-runtime/src/state/threadFork.ts, and have mobile's `forkThread`
  (useThreadListActions.ts:250) pass the numbered title the same way web does at
  useThreadActions.ts:597-601. Web's import site changes to the client-runtime path; nothing
  else moves.

**Two repositories are provided twice in the same pipe**

Harmless at runtime, but it is four lines where two are needed and it reads as an unresolved
merge. It will survive forever unless someone deletes it now.

- Evidence: apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1767-1770 —
  `ProjectionThreadRepository` and `ProjectionThreadMessageRepository` each appear twice
  consecutively

- Fix: Delete lines 1769-1770.

**overview.md documents client preconditions the client rejects, and a decider check the decider relaxes**

These are the two hardest rules in the feature to get right, and the architecture doc states
both of them backwards relative to the code. Anyone reconciling client and server behaviour from
the doc will conclude the client has a bug.

- Evidence: docs/internals/overview.md:121-124 ("one more the decider leaves to them: the source needs
  at least one completed turn") vs packages/client-runtime/src/state/threadFork.ts:47-58,
  which says gating on that "hides the action almost everywhere";
  docs/internals/overview.md:97-99 ("a session attached and settled") vs
  apps/server/src/orchestration/decider.ts:383-390, which permits `source.session === null`
  when the source is itself a fork

- Fix: Replace the completed-turn sentence with the real rule: the client cannot see whether a
  provider conversation exists, so `ProviderService` checks the resume cursor and fails with a
  specific message (threadFork.ts:52-58 already words this well). Amend the decider sentence
  to "a session attached, or a fork whose lineage has one".

**Contract doc claims OpenCode consumes `tipTurnId`; the adapter deliberately never sends it**

`tipTurnId` is a contract field whose justification names two consumers and has one. A reader
deciding whether the field is worth its optionality is given double the evidence that actually
exists.

- Evidence: packages/contracts/src/orchestration.ts:266-269 ("Adapters that can pin a fork point use it
  (Codex `lastTurnId`, OpenCode's exclusive `messageID`)") vs
  apps/server/src/provider/Layers/OpenCodeAdapter.ts:1238-1266, whose own comment says "the
  tip fork omits it entirely" and which passes only `sessionID`

- Fix: Change the parenthetical to name Codex only, and note that OpenCode forks at the tip because
  its `messageID` is exclusive. If Codex ends up the sole consumer long-term, `tipTurnId` is a
  candidate for deletion — it is otherwise only read by `threadHasOwnTurns`
  (apps/web/src/threadFork.ts:61-66), which has a documented fallback for its absence.

## The biggest gap, stated plainly

There is **no test anywhere proving a fork seeds a provider session** — the "same agent memory"
half of the feature is unverified at every layer, and the `ws.ts` fork dispatch path, including its
compensation, has no test either. Three data-loss guards would survive deletion with the suite
green. That is the first thing to fix for anyone building on this.

## Verification status

Full server suite (1,839 tests) passes; typecheck is clean across contracts, shared, client-runtime,
web, mobile and server. The feature was exercised by hand against a copy of a real database, which
is how several of the fixed bugs were found.
