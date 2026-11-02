# Chat/Cowork launch audit

Status: **in progress — not release sign-off**.

Source: `jamesdam/merge-chat-cowork`, base HEAD `9733e9416`; audit includes uncommitted changes. Remote QA must use the working-tree snapshot, not HEAD alone.

## Local validation

- ESLint: passed.
- TypeScript (`yarn workspace @janhq/web-app exec tsc -b`): passed.
- Full web suite: **350 files / 4,631 tests passed** (latest local run).
- Rust thread suite: **42 passed** after propagating directory-deletion errors.
- `git diff --check`: passed.

## Review findings addressed

### Astra
- Authoritative Cowork project association overrides stale mirrored thread metadata during bulk deletion.
- Submitted new conversations use fresh sessions and explicit model/folder/project values; refused first requests cannot leak old workspace configuration.
- Serialize shared deletion journal updates; record deletion intent before file removal.
- Project deletion awaits conversation deletion and surfaces failure; Rust directory deletion propagates errors.
- Narrow windows can open the overview as a sheet; preview falls back to an overlay when pane minima cannot fit.
- Sampling/model settings explicitly restore focus to persistent composer buttons.
- Recheck: sync initialization now propagates failures and resets its cached promise for retry, preventing false successful deletion with no sync subscription.

### Fable
- Workspace cleanup is best effort and cannot resurrect a successfully deleted session.
- ID-collision placeholders preserve the unrelated chat backend and shared thread entry.
- Bulk deletion waits for sync readiness; close/visibility flush also awaits deletions.
- Splitter labels translated, keyboard sizing guards unmeasured width, inner overlay Escape handling improved.
- Initial broad review exhausted its turn budget; a targeted review returned findings above. Neither review substitutes for platform runtime QA.

## Refactoring

- Shared `ConversationColumn`: one 880px maximum and native scrollbar-gutter policy for transcript and fixed composer.
- Removed layout-consuming composer border padding; streaming border is an absolute decoration.
- `CoworkComposerMenu`: separates surface-owned workspace/plan actions from shared composer actions.
- Preview sizing stores a ratio, defaults to half the remaining content area, clamps without overwriting preference, and provides keyboard resizing/reset.

## Manual macOS walkthrough

Isolated state: `/tmp/jan-qa-root`; normal installed Jan data was not modified.
Evidence: `/tmp/jan-launch-audit/` (local, not committed; screenshots may include fixture titles).

Exercised at 1450, 1200 and 1024 CSS-pixel window widths (native minimum prevented smaller macOS window):
- Light/dark home and Cowork mode; sidebar open/closed.
- Searchable model menu, keyboard search/selection attempt, model-settings sheet.
- Sampling opened using keyboard; discovered close-button/gear overlap and added separate dialog header.
- Conversation overview, preview opening, resizing to narrow overlay, Escape.
- Artifact library and compact file cards.

Visual findings fixed:
- Dark model pill used darker app background; now uses a subtle raised neutral surface.
- Overview at 1024px left too little transcript width; docked overview now starts at 1280px, below that a sheet.
- Textarea autosizer did not remeasure parent-only width transitions; added width observation and explicit line-height.
- Header drag overlay intercepted controls; pointer hit areas now above drag surface while empty header space remains draggable.

## Cross-platform preparation

- SSH confirms Linux `x86_64` and Windows 11 `AMD64`.
- Linux isolated snapshot: `/home/james/jan-ui-audit-20261031`, separate Xvfb `:78` + Openbox. Frontend and native e2e-feature build passed. Corrected native WebKitGTK screenshot (`/tmp/jan-launch-audit/linux/native-caption-corrected.png`) shows the Linux top-right Close control and the current composer. Openbox initially reports a close-only layout. Initial onboarding/old-process screenshots are NOT sign-off evidence. Nightly build metadata is being applied only in the isolated QA copy to exercise gated Cowork; this build-only delta must be recorded in its manifest. Existing displays/apps left alone.
- Windows native x86-64 build completed successfully (`BUILD_EXIT=0`, executable SHA-256 `E5DC38BDDE161F1188DCD8E0C8C1121DD26262881C6844D3C32809A52F1783EF`). No interactive Windows user is logged in (`query user` reports none); native pointer/keyboard QA is blocked until desktop login. No auto-login/authentication changes made.
- Static platform finding fixed: right-side caption strip is 60px high, but overview offset was 44px. `TITLEBAR_HEIGHT` now supplies the 60px offset; targeted header/overview tests pass. Runtime verification still pending.

### Linux evidence reviewed so far

- Corrected nightly-native Cowork capture: `/tmp/jan-launch-audit/linux/cowork-nightly-3-controls.png`.
- Proper persisted dark theme: `/tmp/jan-launch-audit/linux/cowork-dark-real-1600.png`.
- Both show three right-side caption controls, overview beginning below the 60px strip, toggle to their left, and aligned transcript/artifact/composer edges.
- Early dark captures that only toggled the DOM class left the light sidebar accent override in place; those are invalid theme evidence. Persisted theme + normal hydration corrects the surface. Do not report this QA-script artifact as a product color bug.
- Fixtures are synthetic/keyless, with no model inference or external model services used. UI behavior does not establish real-provider generation correctness.

### Linux preview/runtime checks

- `preview-html-rendered-1024.png` displays the actual synthetic HTML in native WebKitGTK, filling the available content area below the header at 1024px; focused X11 Escape closes it.
- `preview-html-rendered-1600.png` captures split preview on the wide layout.
- Early `preview-html-dark-*.png` 404 captures were invalid fixture setup (files placed under thread scope instead of Cowork session scope). After correcting only isolated fixture paths, HTML renders. Those early captures are NOT passing evidence.
- Real theme hydration (not DOM-class-only switching) is required for the sidebar accent surface.

## Outstanding verification / limits

- Native Linux x86-64 scoped UI QA completed on Xvfb/Openbox + WebKitGTK: hydrated light/dark at 1600/1280/1024px, sidebar open/closed, three right-side caption controls using isolated KDE config, native pointer overview open/close, actual HTML split/narrow preview, and focused Escape. No confirmed product blocker in these flows. QA Jan PID 665640 stopped; preexisting displays/apps untouched.
- At 1600px, caption buttons occupy x=1488–1584/y=14–46; overview toggle x=1120–1152/y=14–46; panel begins y=60. No measured caption overlap.
- Linux evidence/geometry: `/tmp/jan-launch-audit/linux/real-cowork-*`. Isolated build metadata only: web-app version `0.7.6` → `0.8.8-nightly-QA` to enable nightly Cowork; app source unchanged. Build env: `TAURI_ENV_PLATFORM=linux IS_DEV=true IS_TAURI=true`.
- Windows manual GUI QA remains BLOCKED by no desktop login. Initial native x86-64 build and subsequent explicit-Windows-platform rebuild both passed (latest Cargo completion: 5m20s). No Windows pointer/layout sign-off claimed.
- Final Linux sampling screenshot confirms rendering; dismissal/focus-restoration retest was inconclusive, so not counted as passed.
- Phone-sized full-viewport preview implemented, but macOS native minimum prevents real phone-width native testing. Needs browser geometry/interaction coverage or mobile runtime.
- No screen-reader certification or complete WCAG audit; keyboard checks and semantics are partial.
- No claim that all provider/model APIs were exercised. Reasoning settings have automated coverage, not real requests across providers.
- Active Cowork run turns still commit at run completion; crash checkpointing remains a known preexisting limitation.
- New UI translations are primarily English.
