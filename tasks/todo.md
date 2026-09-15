# Cold review of PRs #22–#40

## Goal and outcome

Review every open PR before reading previous discussions, reconcile findings, fix confirmed defects, preserve agreed features, and prepare one integration PR without merging anything on GitHub.

- [x] Pin and independently review all 19 open PR heads.
- [x] Reconcile against GitHub discussions and the earlier fixes in #39.
- [x] Resolve feature decisions with the user.
- [x] Integrate both stacks locally without rewriting their original branches.
- [x] Fix confirmed defects, including related pre-existing security and routing defects.
- [x] Run project gates, offline mobile/desktop checks and targeted mutation tests.
- [x] Obtain independent acceptance of the final corrections.

GitHub had no existing comments or reviews at reconciliation time. Historical findings were recorded in #39’s body and commits; fixes already present there were retained rather than reported as missing.

## Scope and integration

The original stack is #22–#33, followed by sibling stacks #34–#38 and #39–#40. Local merge `f681835` combines pinned #40 (`e19089a`) and #38 (`ea1659d`). All original PR heads are ancestors of the integration branch. Original contributor branches, `main` and the existing phone-test checkout remain unchanged.

Reviewed areas: transcripts and metadata; remote identity and authorisation; receipts, drafts and submission queues; navigation and components; publication and asset retention. Conflicts in the conversation page, sidebar resizer and back tests preserve both feature sets.

## Agreed behaviour

- Keep Comfortable/Wide/Full choices and the other desktop improvements.
- Retain Herdr’s default operational lifecycle; no bespoke Waiting state or guessed idle override.
- Keep automatic local OMP command discovery, with startup/extension execution documented; never launch it for remote discovery.
- Track the latest recorded parent-session model, not an unverified opening fallback.
- Preserve thinking timing, tested cold-entry semantics, sidebar modes, machine inheritance and local image support.
- Attachments remain host-local/shared-storage; same-origin download protection remains raster-only.

## Corrections and independent review

Initial corrections through `441b4f4` covered reconnect timing, metadata, redaction/child parsing, drafts, navigation, drawers, diff rendering, receipts and staged publication.

Independent server/UI review found related gaps in remote transcript resolution, identity caches, active-asset retirement, directory migration, parent metadata, terminal submission, off-screen acknowledgements, filtered rings, multi-select submission and Home dialog identity. Corrected in `645c3f9` and `5d0b595`, with actual-handler and browser regressions.

Final targeted corrections:

- `703c61e`: Submit is bound to the original dialog, emits at most one Enter, then only observes. Captured stale write-ins are rejected before input is sent.
- `32e912c`: actionable enrichment cache entries and asynchronous results follow current permitted connection identity across retargeting, session changes and revocation.
- `a44be5f`: terminal write-ins share the complete type/key queue and capture pane, row, dialog and text. Replacement or failure cancels obsolete continuations; refusal preserves an explicit retry.

The independent reviewer replayed the original three counterexamples against `a44be5f` and returned **PASS for those corrections and their direct effects**. This is not a claim that external terminals can be controlled atomically.

## Verification

Post-commit tracked-source archives at `a44be5f` passed:

- Typecheck: 0 errors, 0 warnings; Prettier and ESLint passed.
- Unit suite: 877 tests across 109 files.
- Isolated adapter build.
- Offline browser suite: 62 runs, covering 31 desktop/mobile scenarios twice, no skips.

Independent targeted acceptance also passed 39 handler/helper tests, a fresh build, 18 focused browser checks and a separate replay of the original terminal queue failure. Both archives were compared with all 372 tracked files at the reviewed commit; no mismatches.

Seven individually applied unit mutations and four separately built browser mutations failed for their expected behavioural assertions, then restored positive checks passed. Mutation work was confined to disposable archives, never the source checkout.

Reproducible browser checks use `playwright.cold.config.ts` after building into `.e2e-build`. They use invented payloads and invalid Herdr endpoints; they do not drive live panes. The live-browser configuration excludes these fixtures because its base URL and viewport differ. Independent `--list` checks confirm the live and offline selections do not overlap. Server tests separately exercise actual handlers and parsers with synthetic transport.

## Publication and merge plan

The repository permits squash merges only. Publish the integration/fix branch as one PR targeting `main`; after its final checks and review are accepted, **squash that PR once**. Do not separately merge the conflicting original stacks: their reviewed content and corrections are already included. The original PRs remain open until the owner closes them as superseded after integration verification.

Leave one consolidated comment only on original PRs with useful new findings. GitHub is the record of publication and comment receipts, not a second status log in this file. No GitHub merge, closure or deployment is authorised by this plan.

## Remaining limits

No live harness, real SSH target, production service-manager migration/rollback or physical phone was exercised. Browser APIs are intercepted; actual-handler tests use synthetic transport. Changed local model files still rescan with unchanged-file caching; remote metadata remains bounded. Ambiguous/interrupted sends stay unconfirmed. Prior releases require operator cleanup. Existing directory installations need the explicit staged migration documented in `README.md`.
