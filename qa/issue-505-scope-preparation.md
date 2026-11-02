# #505 scope preparation — bounded verification

Production commit: 20d67d6db, rebased on 9207feb31. Preparatory only; #505 and runtime consolidation remain open. No preview flag or nonfunctional folder submit path is shipped.

## Checks
- Final independent code reviewer: **PASS**, no blocking/should-fix findings at `20d67d6db`; 108 targeted tests passed across 5 files.
- Post-`9207feb31` rebase full web suite: 4,970 tests / 371 files passed.
- Post-rebase TypeScript (`cd web-app && yarn tsc -b`) and `git diff --check`: passed.
- Local dependency packages were built before tests; initial missing-package failures were resolved, not hidden.

## Separate final verifier gate
Current-source focused unit tests: 32/32 passed. Initial final browser rerun **failed** because the moved fixture CSS returned HTTP 500; older supposed Chat-switch evidence was not sufficient to prove retention. This failure is not waived. **Final bounded recovery: PASS** at production `20d67d6db`. Restored a real temporary copy at the original path and obtained a fresh styled render. Removed folder and asserted project retained; selected `home-mode-chat` and asserted `aria-checked=true` before checking exact draft and synthetic document retention. All fresh assertions passed. Theme/narrow and unsupported synthetic-send coverage remains historical-only, not freshly repeated. No native/runtime/provider claim. Report `/tmp/jan-505-final-verification.md`; fresh evidence `/tmp/jan-505-bounded-switch.log`, `/tmp/jan-505-bounded-switch.cjs`, `/tmp/jan-505-fresh-render-switch.png`. Temporary fixture copy removed. Existing light/dark desktop and 390×844 dark narrow captures were inspected; model truncation is preexisting, not expanded scope.

Temporary fixture/screenshots remain local only at `/tmp/jan-505-local-evidence/fixture/`; no synthetic surface is committed. No native/provider/runtime parity claim. Server is parent-owned PID 33251 (verify exact process before stopping after merge); remove temporary restored fixture path after verifier.

## Runtime drain / next owner
Follow `plans/unified-home-runtime-handoff.md`: consolidate actual `runTurn` around the serializer and shared policy, preserve grant/history continuity, and replace the legacy split using this same composer. No additional permanent flag or parallel surface. Coordinate before editing serializer/route/transport files. Coordinator owns native isolation gate and sequential merge after bot review; this preparatory PR does not complete #505.

## Bot findings addressed
Removed the dead in-memory legacy attachment migration and obsolete migration assertions. Retained the canonical bucket workflow-switch test. Confirmed project-only/no-folder scope from actual session workspace resolution (details in runtime handoff); optional copy is accurate and unchanged. Updated handoff base to `9207feb31`.
