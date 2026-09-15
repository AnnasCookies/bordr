# Cold review of open PRs #22–#40

## Goal

Review every open PR independently of previous commentary, reconcile findings with existing GitHub discussions, fix confirmed defects, prepare accepted fixes for a later parent-approved fix PR, and report the final merge order. Local integration and focused fix commits approved; no GitHub merge, push or contributor-branch edits.

## Approach

- [x] Fetch and pin all open PR heads and bases in /tmp/bordr-cold-review-prs.json.
- [x] Create isolated sibling worktree cold-review on fix/cold-pr-review at e19089a.
- [x] Parallel cold reviews by source boundary, with no prior review/comment input.
- [x] Reconcile frozen cold findings against existing GitHub comments and current code.
- [x] Resolve feature/anti-pattern conflicts with the user before changing their intent.
- [x] Apply minimal confirmed fixes with regression checks; preserve original checkouts.
- [x] Relevant lint, type, unit and offline mobile/desktop gates.
- [ ] Independent acceptance review (parent owns reviewer launch).
- [ ] Post one consolidated comment only where useful; no empty approval comments.
- [ ] Give overall findings and dependency-correct merge order.

## Baseline evidence

- Pinned PR40 head: `e19089a83357dc12b9188937673c6f426e7131ea`.
- Frozen dependency install passed; typecheck: 0 errors, 0 warnings; unit: 804 tests across 94 files passed; lint passed after formatting this new plan.
- Evidence: `/tmp/bordr-cold-review-baseline.md`.
- Native workflow: `27bdb7f8-a786-4494-9b07-d8cbe5b0b2d3`; mission: `3ab1756e-1334-4450-8072-c6c1c01c04d1`.
- A merge-tree dry run (no branch merged) found cross-stack conflicts in `e2e/back.e2e.ts`, `src/lib/components/sidebar-resizer.svelte` and `src/routes/a/[pane]/+page.svelte`.

## Scope and risks

- 19 open PRs: linear #22–#33, then sibling stacks #34–#38 and #39–#40.
- Source seams: transcript/server, shared components, pages/navigation, controls/machines, Pi/tool rendering, desktop/order, previous fixes/attachments/deployment.
- main has existing untracked docs/ and tasks/; leave untouched. review-stack is clean; leave untouched.
- Avoid reading real environment files, session data or transcripts. Tracked source/tests and public PR discussions are authorised review material.
- Do not deploy, operate live agents, delete worktrees, push or merge GitHub PRs. Local #38 into #40 integration explicitly approved.
- Fix placement and cross-stack conflict resolutions must preserve both feature intent and previous corrections.

## Recovery execution

- [x] Read reconciled source findings and approved D2–D10 boundaries. D1/D5 pending parent.
- [x] Integrate pinned #38 `ea1659d` into #40 `e19089a` locally, preserving width choices, pointer ownership + RAF, both browser groups and single pending metadata.
- [x] Correct all source-verified remaining findings, including separately attributed older defects.
- [x] Focused and full offline validation, isolated build, browser regression checks.
- [ ] Independent review and parent acceptance before publishing anything.

## Implementation evidence (in progress)

- Integration merge `f681835`: #40 `e19089a` first parent, pinned #38 `ea1659d` second; widths retained; ownership + RAF; both e2e groups.
- Older/pre-existing corrections: `7706315` cached machine policy/target/session identity; `23e9032` native Git worktree metadata. Focused tests: 11/11 and 19/19 respectively.
- D1 resolved by parent: retain automatic local OMP discovery; document startup execution and retain remote prohibition.
- D5 resolved: latest recorded model, cached by file identity/change metadata; append/truncation/replacement regressions. Remote tail limitations remain explicit.
- D6 source inspection (installed public Pi 0.85.1 only): `setWorkingVisible(false)` can hide work while streaming; `IdleStatus.render()` emits blanks; editor accepts steering while active. Parent accepted discrepancy diagnostic rather than unsafe idle override. No live panes/config/sessions inspected.
- D4 has no existing Waiting enum/label in source. Parent instructed not to invent one; explicit Waiting requirement remains pending clarification. Quiet unresolved children stay unfinished; Off keeps existing archive and All includes finished children.
- Final combined gates: typecheck 0 errors/warnings; full unit 849/849 across 102 files; lint passed; isolated adapter build passed; offline browser suite passed 20/20 across two repetitions (10 tests), plus strengthened 80-line diff check passed.
- No push, PR creation/comment, GitHub merge, deployment or live-agent action performed.

## Final validation and attribution

- #22: watchdog attempts get their own deadline (`agents-store.test.ts`); bounded header cwd survives >2,000 tiny rows (`agent-detail.test.ts`); OMP non-live asks suppressed in detail/list; attic two-cycle age test; duplicate todo snapshot browser test; correct upstream branch URLs.
- #24: interrupted POSTs restore as explicitly unconfirmed, retained until user recovery; service-worker activation only notifies visible/hidden clients.
- #26: parsed-text queue redaction on both transports; explicit child parsing; duplicate/old/skew queue occurrences remain unconfirmed while unique current enqueue/dequeue confirms. Pending transcript matching now requires current occurrence timestamps.
- #27/#31: silence is not Done; Off preserves all children in existing archive; All shows finished-only children; full-tree stable swipe ring includes shells even with hidden strips; capture close membership before request; sheet bounded/scrollable.
- #30/#32: Files drawer sibling placement, Files/Search desktop drawers, shared gesture root with separate desktop scroll host. Offline touch tours pass in both transcript and terminal modes.
- #33/#39: displayed branch passed through gh arguments/cache/inflight identity; untimestamped queued reruns preserved; remote scans guarded before promise creation; staged publication failure leaves active entry/routes/dependencies/version unchanged; public config and upgrade docs updated.
- #35/#36: padded native diff line numbers preserve code indent; gutters do not shrink; reload requires new positive success after observed progress, never disappearance/old success/failure; total 5-second observation deadline; lifecycle retained across custom/missing/degraded Pi screens with named discrepancy diagnostic.
- #38/#40 integration: Enter queued behind arrows and fresh same-dialog selection, pane/dialog invalidation, focused summaries/resizers ownership, active write-in first digit preserved; write-in clear/restore merges drafts on the original pane; Home preference-switch fixed without changing cold-entry semantics; bubble tail space reserved inside containment.
- Preserved #34 thinking timing, #37 grouped/priority ordering, width choices, #39 pointer ownership plus #38 RAF, existing machine inheritance and local/shared attachment ceiling. No stale fixes duplicated.
- Additional offline checks exposed and corrected two implementation gaps: same-dialog refresh was invalidating queued Enter, and the bounded header's own >2,000 rows hid cwd. Native tail geometry needed 16px containment allowance, confirmed by browser bounding boxes.
- Browser command: `bunx playwright test --config playwright.cold.config.ts --repeat-each=2` after `BORDR_BUILD_OUT=.e2e-build bun run build`; 20/20 passes on the 10-test suite at last run. Only invented route-intercepted payloads; HERDR_SOCKET and HERDR_ENDPOINTS are invalid fixture paths. Original live-dependent suites retained but not driven against live panes.
- D4 follow-up: no Waiting field/label exists in the source/protocol mapping. Parent explicitly instructed not to invent one or infer it from silence; preserve actual Herdr working/idle/done. Parent is handling remaining user clarification.
- Independent review and parent acceptance remain required before any push/new PR/comment; no staged leftovers at handoff.

- Final corrective refs: `4d3e43f` publication/attic/docs; `2b28685` server metadata/lifecycle/queue/PR fixes; `c3a4940` UI/draft/swipe/drawer fixes; `2db1ba8` historical reload confirmations; `5ecb28a` dense-header cwd plus real detail-route regressions; `aadb79e` dialog refresh ownership, tails and offline browser fixtures. Integration and older-defect refs are recorded above.
- Logs: `/tmp/bordr-check.log`, `/tmp/bordr-lint.log`, `/tmp/bordr-unit.log`, `/tmp/bordr-build.log`, `/tmp/bordr-browser.log`, `/tmp/bordr-browser-layout.log`. Intermediate failing checks were corrected, not counted as passing evidence.
- Residual ceilings: model metadata streams changed local files in full (cached when unchanged); remote transcript/model metadata remains bounded; ambiguous queue occurrences stay unconfirmed; prior self-contained releases require operator cleanup after verifying no process uses them. No active service release was touched.
- Final source/diff inspection: `git diff --check e19089a` clean; all original feature ancestry retained. Proposed eventual GitHub merge order remains #22 → #23 → … → #40, with no deployment of intermediate prefixes. Nothing published by this worker.
