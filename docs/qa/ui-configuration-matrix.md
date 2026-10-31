# UI configuration regression matrix

## Current status

This document records the earlier partial passes. The systematic 30-case follow-up is tracked separately in **[ui-matrix-full-round.md](ui-matrix-full-round.md)**, including native persistence/toggle checks, minimum-width geometry, and final dispositions. **Untested cells and partial subcases below are historical gaps, not blanket passes.**

### Refactor scope

- Shared fixed 16px assistant avatar slots for emoji/image/fallback; stable row icon/checkmark geometry and long-name truncation.
- Sidebar icon wrappers no longer shrink; consistent text line height and shortcut slots.
- Skills/project assistant rows aligned; preview toolbar uses shared 32px action buttons.
- Composer controls vertically centered; model picker has instance-scoped accessibility IDs and corrected reasoning value/chevron spacing.
- Existing user decisions preserved: Plan icon only, white composer, light focus border black/20, model at bottom-right, narrow controls never wrap, hidden shortcuts accessible via +, folder pills above composer.

### Isolation

- Native e2e binary built with QA identifier `ai.jan.qa.uimatrix20261031` and macOS incognito webview.
- Added `JAN_E2E_NO_KEYRING=1` opt-in, compiled only with `e2e`, to bypass shared OS credential read/write/delete and use isolated file fallback.
- QA config, synthetic fixtures, logs and screenshots: `/tmp/jan-ui-matrix-qa/`.
- No production inference or provider validation claimed; e2e resource stubs remain in use.

## Setup findings and regression checks

- Resumed isolated native shell initially rendered an empty `tauri://localhost` page. Native screenshot: `/tmp/jan-ui-matrix-qa/ready.json` (original screenshot path recorded there). This is a **failed launch**, not a passed UI check.
- Diagnosis: plain Cargo build enabled `custom-protocol` while `web-app/dist/index.html` was empty; navigation to the dev server was rejected by the production navigation guard. Rebuilt the e2e shell in dev mode without `custom-protocol` and verified the rendered native UI; release application behavior was not changed to accommodate QA.
- Earlier full web regression suite: **354 suites / 4,662 tests passed**; log `/tmp/jan-ui-matrix-qa/full-web-regressions.log`.
- Systematic-round fixes: project async save lifecycle and scope-bound skill editor; both independently reviewed. Post-fix full web suite **355 suites / 4,670 tests passed**; full ESLint, typecheck and whitespace checks passed. Logs `/tmp/jan-ui-matrix-qa/full-round-postfix-{tests,lint,types}.log`.
- Final full web ESLint and TypeScript build passed after native captures; `git diff --check` passed. Lint log `/tmp/jan-ui-matrix-qa/full-web-lint.log`.
- Current focused regression run: **83 tests passed across 7 suites** (assistant avatar/menu/switcher, skills, model picker, preview, overlay layers). TypeScript build passed. Logs: `/tmp/jan-ui-matrix-qa/matrix-regressions.log`, `matrix-types.log`.

## Native manual matrix (2026-10-31)

Detailed actions, visual findings, caveats and evidence: `/tmp/jan-ui-matrix-qa/MANUAL-RESULTS.md`. Native Orca PID 20020, 1200×800 logical window. All listed evidence uses that directory; PNGs have matching AX JSON. Fixture hydration/WD refresh was setup only, not manual coverage.

| Surface/configuration | Light | Dark | Narrow/split | Key interactions / limitations |
| --- | --- | --- | --- | --- |
| Home Chat / Cowork | Not tested | Earlier parent home capture; no added home pass | Not tested | No inference or sends |
| Conversation / preview | Inspected `manual-preview-light.png` | Inspected `manual-preview-dark.png` | Inspected 480px preview and ~480px conversation pane | Native HTML card open, toolbar geometry, folder-above-composer and bottom controls clean; other formats/actions untested |
| Model picker basic / reasoning / long name | Basic inspected `manual-model-preview-light.png` | Basic inspected `manual-model-preview-dark.png`; supported reasoning follow-up below | Dark effort submenu actually overlaps preview | Native gpt-5.2 selection, brain row, Medium→High retained on reopen, clean footer labels and submenu stacking verified; light effort and long model name **not tested** |
| Assistant default / multiple / long name | Inspected `manual-assistants-light.png`, `manual-default-open-light.png`, `manual-assistant-edit-light.png` | Nested parameter menu inspected `manual-start.png`; settings not tested | Not tested | Actual default menu opened, reviewer edit populated, dismissed without save; long menu label wraps cleanly |
| Projects plain / assigned assistant | Not tested | Earlier parent New Project/nested menu evidence only | Not tested | Create/save/assignment persistence **not tested**; injected project is setup only |
| Skills empty / global / project | Populated global list/editor inspected `manual-skills-light.png`, `manual-skill-populated-editor-light.png` | Earlier parent empty/editor evidence only | Not tested | Native select loads Markdown, Escape; no save/project scope pass |
| MCP/tools disabled / synthetic configured | Partial settings inspected `manual-mcp-light.png` | Not tested | Not tested | Enabled fixture indicator and aligned settings; parent inspected `manual-mcp-lower-light.png`, confirming enabled fixture / inactive fixture / Jan Browser off rows visible. Toggle attempts unchanged: **no successful toggle claim**; tools runtime not tested |

No concrete new rendered alignment/clipping regression found in inspected configurations; no additional production patch from this pass. Assistant light card fill/name hierarchy is faint but readable (polish observation, not a confirmed failure). Native drag did not change divider width; narrower widths are untested. Model menu remains left of preview divider: coexistence screenshots do **not** prove stacking when geometrically overlapping the preview. Full web regression run reported by parent: 354 suites / 4662 tests passed; these do not replace visual evidence.

## Evidence rules

Each completed cell must identify actual configuration, theme/layout, native screenshot path, visual inspection and interaction result. Unit tests do not establish rendered alignment or stacking. Untested widths, inference, production engines, unsupported fixture capabilities and OS differences must be explicit gaps.


## Targeted supported reasoning follow-up (2026-10-31)
- Exclusive native Orca pass on PID 20020. WD session on port 4447 used **only to refresh** after parent prepared isolated OpenAI `gpt-5.2` capability/settings fixture (loopback `127.0.0.1:18776/v1`, dummy credential, no keyring). All selection/menu interactions were native; no inference or sends.
- Opened synthetic Cowork thread and offline HTML preview, selected `gpt-5.2` natively, then reopened model selector. Visually inspected `/tmp/jan-ui-matrix-qa/reasoning-row.png`: selected model/checkmark, **brain icon + Reasoning / Medium / chevron** all visible and aligned. **Model settings** and **Manage models** have no trailing ellipsis. This verifies labels, not Model settings usability; the earlier empty settings screenshot was an expected synthetic-fixture limitation.
- Opened adjacent reasoning submenu by native coordinate. Visually inspected `/tmp/jan-ui-matrix-qa/reasoning-submenu-medium.png`: Default/Low/Medium/High/Very high readable, Medium checked. The submenu actually crosses the preview divider and is rendered **above the HTML preview**, with intact background, border, labels and checkmark; this closes the previous dark effort-submenu overlap gap.
- Clicked **High** natively; menus closed. Reopened selector and effort submenu. Visually inspected `/tmp/jan-ui-matrix-qa/reasoning-submenu-high-reopened.png`: parent row now **High**, submenu **High checked / Medium unchecked**, selected model still `gpt-5.2`. Confirms selection retained across menu close/reopen (not merely action acknowledgement). App-restart/disk persistence and runtime request parameters were not tested.
- No new rendered defect found and no production source edits. Left app with High submenu open over preview. Project create/assigned-assistant and other previously listed gaps remain untested; intentionally stopped after targeted verification.
