# Cold review of open PRs #22–#40

## Goal

Review every open PR independently of previous commentary, reconcile findings with existing GitHub discussions, fix confirmed defects, publish at most one necessary summary comment per PR, and report the final merge order. Local integration and focused fix commits approved; no GitHub merge, push or contributor-branch edits.

## Approach

- [x] Fetch and pin all open PR heads and bases in /tmp/bordr-cold-review-prs.json.
- [x] Create isolated sibling worktree cold-review on fix/cold-pr-review at e19089a.
- [ ] Parallel cold reviews by source boundary, with no prior review/comment input.
- [ ] Reconcile frozen cold findings against existing GitHub comments and current code.
- [ ] Resolve feature/anti-pattern conflicts with the user before changing their intent.
- [ ] Apply minimal confirmed fixes with regression checks; preserve original checkouts.
- [ ] Fresh review and relevant lint, type, unit and mobile/desktop gates.
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
- [ ] Correct all source-verified remaining findings, including separately attributed older defects.
- [ ] Focused and full offline validation, isolated build, browser regression checks.
- [ ] Independent review and parent acceptance before publishing anything.
