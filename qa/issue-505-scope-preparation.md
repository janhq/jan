# #505 scope preparation — bounded verification

Production changes based on `9207feb31`. Preparatory only; #505 and runtime consolidation remain open. No preview flag or nonfunctional folder submit path is shipped.

## Reproducible checks
After building local core, plugin APIs and extension packages:
- `yarn test:web`: 4,970 tests / 371 files passed after rebase.
- `cd web-app && yarn tsc -b`: passed.
- `git diff --check`: passed.
- Focused regression: `yarn test:web src/routes/__tests__/index.test.tsx src/containers/__tests__/HomeWorkspacePicker.test.tsx src/hooks/__tests__/useHomeScope.test.ts`.
- Attachment ownership regression records the actual `ChatInput.scopeKey` prop and asserts it is absent in both Chat and Cowork home states. Mutation check restores the old mode-dependent `home-cowork` scopeKey and must fail that assertion; restore source and rerun to pass.

## Independent review and verification
Independent production code review passed with no blocking/should-fix findings; 108 targeted tests passed across 5 files. Separate final browser verifier passed the bounded preparatory scope: fresh styled render, folder removal preserves project, explicitly selected Chat radio before asserting exact draft and synthetic document retention.

An initial browser rerun failed because the relocated temporary fixture could not resolve its CSS. Restoring its original layout resolved that harness failure; the fresh selected-radio/retention assertions supersede ambiguous earlier evidence. Existing light/dark desktop and 390×844 dark narrow screenshots were inspected. Theme/narrow and unsupported synthetic-send coverage were historical-only, not repeated in the bounded recovery. Narrow model-label truncation is preexisting. No native/provider/runtime parity claim.

The temporary fixture was removed from the repository. Machine-local evidence and server cleanup details are kept in local notes, not this reproducible record. No synthetic app is shipped.

## Bot follow-up
Removed the dead in-memory legacy attachment migration and obsolete migration assertions. Strengthened the canonical-bucket workflow-switch test to observe the composer boundary rather than only unchanged store contents. Project-only/no-folder workspace copy was checked against actual session workspace resolution; source chain is in the runtime handoff. Handoff base matches `9207feb31`.

## Runtime drain / next owner
Follow `plans/unified-home-runtime-handoff.md`: consolidate actual `runTurn` around serializer and shared policy, preserve grant/history continuity, and replace the legacy split using this same composer. No additional permanent flag or parallel surface. Coordinate before editing serializer/route/transport files. Coordinator owns native isolation and sequential merge after bot review; this preparatory PR does not complete #505.
