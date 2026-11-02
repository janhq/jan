# #505 scope preparation — bounded verification

Production commit: ed8ba47e7, rebased on edd3def38. Preparatory only; #505 and runtime consolidation remain open. No preview flag or nonfunctional folder submit path is shipped.

## Checks
- Independent code reviewer: no blockers. Reviewed actual scope/attachment fixes; 122 targeted tests passed in its check.
- Post-rebase full web suite: 4,970 tests / 371 files passed.
- Post-rebase TypeScript (`cd web-app && yarn tsc -b`) and `git diff --check`: passed.
- Local dependency packages were built before tests; initial missing-package failures were resolved, not hidden.

## Separate manual browser verification
A different subagent used a fresh isolated Playwright Chromium context with the real home route and ChatInput, production CSS, and synthetic hook/service boundaries. It reported and captured:
- Light/dark desktop and actual 390×844 dark narrow screenshots, inspected visually.
- Keyboard Enter opens workspace menu; Escape closes it and returns focus.
- Removing folder retains project; switching to Chat retains draft and synthetic document.
- Unsupported-model direct Chat sends only to synthetic boundary.
- No external/provider requests, attempted application network calls or runtime errors in its recorded audit.

Limits: task submission was intercepted/refused by the fixture, so no runtime/provider execution proof. Settings/sidebar/project dialogs were omitted. Narrow model label truncation remains an existing toolbar limitation; no horizontal overflow observed. No native QA claim. The verifier was stopped at the requested time bound rather than allowed further fixture growth; this record reflects completed evidence and progress reports, not a final agent verdict. Parent also visually inspected desktop-light and narrow-dark captures.

Temporary fixture and screenshots are **local only** at `/tmp/jan-505-local-evidence/fixture/`; they are not a second shipped surface. Screenshots: `evidence/independent-light-desktop.png`, `independent-dark-desktop.png`, `independent-dark-narrow.png`, `independent-chat-retained.png`, keyboard/menu captures. Audit: `evidence/independent-results.json`.

## Runtime drain / next owner
Follow `plans/unified-home-runtime-handoff.md`: consolidate actual `runTurn` around the serializer and shared policy, preserve grant/history continuity, and replace the legacy split using this same composer. No additional permanent flag or parallel surface. Coordinate before editing serializer/route/transport files. Coordinator owns native isolation gate and sequential merge after bot review; this preparatory PR does not complete #505.
