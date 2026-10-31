# Local edge-case native UI round

## Status
Bounded native execution finished with substantial incomplete coverage; this is not a clean full edge-case pass. PASS means the stated full case met; other cases include fixture/tooling blockers and explicitly unexecuted combinations. Two confirmed visual bugs were fixed by parent and native reverified. Target source `d2b5f4254`, isolated native macOS Tauri app, incognito WebKit and e2e-only OS-keyring bypass. Independent Windows ARM Claude QA continues separately.

Setup finding: initial frontend server omitted `TAURI_ENV_PLATFORM=darwin` and incorrectly rendered a Jan label under macOS traffic lights (`/tmp/jan-ui-matrix-qa/edge-native-baseline.png`, actually inspected). Source already reserves native-control space when this build flag is correct. Restarted only the exact QA Vite PID with `TAURI_ENV_PLATFORM=darwin IS_TAURI=true`, then refreshed the isolated app. This is a QA setup failure, not evidence of a production header regression; corrected screenshot verification remains part of the pass.

## Cases

Every result needs native interaction plus screenshot capture and explicit image inspection; fixture seeding and geometry setup are not manual UI passes.

| ID | Case | Result | Evidence |
|---|---|---|---|
|01|Light home basic model, no assistant|BLOCKED (fixture default)|Light Plain home visually clean (`edge-zero-assistant.png` read), but zero custom assistants regenerates built-in Jan selected; not genuinely zero/None. No false zero-assistant pass.|
|02|Single assistant select then explicit None|BLOCKED (seed safety guard)|One-assistant seed refused after zero hydration generated non-fixture built-in Jan: Unexpected non-fixture assistant. Preserved guard; no deletion of built-in profile objects. `edge-zero-assistant.png` read shows None and Jan, not intended one fixture.|
|03|Multiple assistants, long name and selected state|PASS after fix|`/tmp/jan-ui-edge-qa/edge-assistants.png` read: submenu extends beyond right edge, long name and selected check clipped. Parent fix applied at closed-menu boundary; `/tmp/jan-ui-edge-qa/edge-assistant-current.png` read confirms selected long row ellipsized and check visible within window. Do not use mislabeled `edge-03-fixed-selected.png` (accidental dialog; cancelled).|
|04|Assigned project assistant, None and fallback behavior|BLOCKED (fixture reset)|Zero-assistant fixture hydration regenerated built-in Jan and one-assistant seed safety guard refused it; assigned QA assistant no longer available. Project fallback not falsely inferred from home menu.|
|05|Local reasoning Auto/On/Off separate from budget|BLOCKED (fixture hydration)|Local metadata removed by native catalog hydration; absent picker after seed. No real model loaded to work around it.|
|06|OpenAI effort Low/Medium/High/Very high|PASS|`/tmp/jan-ui-edge-qa/edge-06-efforts.png` read: all four plus Default present, Medium checked, icons/text aligned. Selected Very high; closed menus/Escape restores trigger focus. `edge-06-very-high.png` explicitly read on resumed round: XHigh trigger and restored focus visible; reload persistence not claimed.|
|07|Anthropic/Gemini supported reasoning choices|PASS after fix|Native/read `edge-claude-reasoning.png`, `edge-flash-reasoning.png`: Default/Auto/On/Off; Flash Off selected and AX reopen confirms Value1 (`edge-flash-off-confirm`). `edge-pro-reasoning.png` read: Default/Auto/On, Off absent. Parent picker top clipped, WD root y=-3.5 at 801-high window; parent fixed. `edge-fixed-claude-reasoning.png` and `edge-fixed-pro-reasoning.png` captured/read: compact rows, full search/footer, orange selected checks. Both root rectangles top40.5 bottom424.5 height384 within 801 viewport (>=12, <=789); Pro Off absent.|
|08|Non-reasoning model hides unsupported control|PASS|`/tmp/jan-ui-edge-qa/edge-resume-current.png` captured/read: Plain selected, no reasoning trigger, intact synthetic draft, clean light composer.|
|09|Long/unicode model name wide and compact|BLOCKED (compact unexecuted)|Wide portion PASS: native selected long Unicode fixture, `edge-long-final.png` captured/read, ellipsized model trigger does not collide with mode/send. Compact-width counterpart not executed within bounded action budget.|
|10|Image attachment preview/remove, vision model|BLOCKED (remove unverified)|Native Add Images → Cmd+Shift+G exact synthetic PNG → Open succeeded. `/tmp/jan-ui-edge-qa/edge-10-image.png` read: blue thumbnail and red remove control clean; preview PASS, but previous coordinate actions lost image before explicit remove assertion; remove not claimed. No further upload attempt after two chooser failures.|
|11|Non-vision model with image attachment warning/preservation|BLOCKED (send prohibited)|`/tmp/jan-ui-edge-qa/edge-11-nonvision.png` read: selected Plain preserves synthetic draft and PNG; preservation PASS visually re-read on resumed round. Warning branch BLOCKED: Chat send prohibited; no warning verdict claimed.|
|12|Text/Markdown document attachment preview/remove|BLOCKED (native chooser)|Native file dialog opened; exact synthetic summary.md path entered via Cmd+Shift+G. Native AX operations now take ~20–30 seconds each; prior attempt did not complete. Second attempt completed (117s); `edge-md-final.png` captured/read: Go sheet held unrelated clipboard text, not requested synthetic path. Native paste tooling did not deliver exact path. No chip; cancelled, no PDF or text upload claimed.|
|13|Multiple mixed attachments and long filenames|BLOCKED|Depends on actual document upload; two bounded Markdown path attempts failed at native chooser/paste layer (case12). No mixed-chip pass claimed.|
|14|Rejected/oversized attachment feedback and composer preservation|BLOCKED|Native exact-path chooser/paste failed twice (case12); did not risk clipboard selecting any real file. Oversized fixture not opened/read; limit feedback untested.|
|15|Assistant/settings modal with attached draft|BLOCKED|Image no longer attached after prior coordinate misnavigation; native exact-path replacement blocked (case12). No attached-draft modal preservation claim.|
|16|Keyboard mode/model/reasoning menus and Escape focus|BLOCKED (partial keyboard coverage)|Space opened model/plus; Escape closed chooser and restored plus focus (`edge-dialog-cancelled.png` read). Full mode/reasoning keyboard traversal not completed; ArrowRight unsupported by native tool, no false pass.|
|17|Dark compact composer plus/active controls, upload chips|BLOCKED|Required upload chips unavailable after chooser tooling failures; dark compact combined state not executed within bounded round. Earlier dark home alone is not this case.|
|18|Light compact long model plus image/file chips|BLOCKED|Wide long model visually PASS (`edge-long-final.png` read); compact mixed image/file chips unavailable after native chooser failures. Not passed from wide empty composer.|
|19|Skills Global/folder destination and dirty discard guard|BLOCKED (folder scope absent)|Global destination native verified; Scope menu only global on home (`edge-skills-scopes`). Native typed synthetic skill name, Close → discard guard (`edge-skills-discard.png` read), Discard closed modal. Guard PASS; folder destination unavailable in home fixture, not claimed.|
|20|Refused Cowork model preserves text and attachments|BLOCKED (attachment prerequisite)|`edge-20-cowork-ready.png` is NOT evidence for this case: coordinate click reset Chat draft and remained Chat. No Cowork send attempted.|

## Safety and limits

Only synthetic local files and metadata; no external credentials/provider calls or real inference. Unsupported runtime fixtures must be named, not treated as working models. Native file chooser actions may be blocked by platform tooling; failures and attempts stay explicit. No name-based process kills or signals against supervising agent groups. Do not count automated tests as visual evidence.

## Live execution notes

- Native PID 23677 exclusive driver. All actions native Orca targeted exact PID with restore-window. No inference/send/load performed.
- Capture helper copied to `/tmp/jan-ui-edge-qa/capture.py`; all new evidence belongs to that edge directory (reported `/private/tmp` is the same macOS directory).
- `/tmp/jan-ui-edge-qa/edge-01-start.png` explicitly read: corrected macOS header clean, traffic lights and sidebar icon aligned; no Jan title beneath traffic lights. Initial bad Vite platform configuration is a setup failure, not a production defect. Initial theme System resolved dark; switched via Appearance to Light. Light home capture `/tmp/jan-ui-edge-qa/edge-01-light.png` explicitly read: clean header, basic model and plus/mode controls aligned; zero-assistant fixture variant remains.
- Fixture caveat: local metadata model absent from native picker; remote labels render IDs because fixture incorrectly uses `name`, while source `getModelDisplayName` uses `displayName || id`. Corrected fixture prepared offline at `/tmp/jan-ui-edge-qa/matrix-display-name-corrected.json`; not yet seeded. Local hydration absence still needs diagnosis, never load a real model.
- Resumed after parent-authorized assistant-overflow HMR fix. Corrected fixture seeded and WD refresh used only at setup boundary; display labels now native verified. No source files edited by driver. Remaining PENDING cells genuinely unexecuted, not silent passes.

- Upload progress: valid PNG actually loaded and visually read; changing to Plain kept text and thumbnail. A later coordinate click hit empty space/reset rather than intended Cowork; do not infer refused-send success. Recreated synthetic draft. Native dialog actions are serialized despite slow AX snapshots.

- Resumed driver: native element click focuses controls without reliably activating; Space activates focused plus menu, Return opens actual native file sheet. Read-only WD rectangles used for geometry only. Exact-path Markdown attempt bounded at two total (prior driver + resumed). No file chip assumed from a folder-only sheet.

- Native chooser cancellation verified in `edge-dialog-cancelled.png` (captured/read): sheet closed, Plain model and synthetic text preserved. Wrong pasted content is a native-tool/clipboard setup failure, not a Jan product defect; unrelated clipboard contents intentionally omitted.

## Final bounded-round summary

- 20/20 cases assessed: **4 full PASS** (03,06,07,08), **16 incomplete** (fixture/tooling blockers plus explicitly unexecuted compact/dark combinations), **0 unresolved confirmed FAIL**. Budget-limited/unexecuted cases are not technical blockers; they still require another pass. Partial successes are described individually, not counted as full passes.
- Final full regression: **364 suites / 4,816 tests passed**; full web ESLint and TypeScript build passed. Independent narrow reviews approved both UI fixes. Logs under `/tmp/jan-ui-edge-qa/`: `final-picker-tests.log`, `final-picker-lint.log`, `final-picker-types.log`.
- Parent assistant overflow fix native re-read; parent picker clipping/compact/accent fix native re-read and measured for Claude and Gemini Pro. No source edits made by this driver.
- No Chat send, Cowork run, inference, real-model load, or download initiated. An unintended Hub navigation occurred from a stale AX index after Escape dismissed Skills; no download clicked. Subsequent actions used fresh captures.
- Wrong-text chooser capture contains unrelated clipboard content: do not publish `edge-md-final.png`; report only sanitized tooling failure. Native type-text successfully verified the synthetic skill name without clipboard.
- Final native state: PID23677 alive, light home, long Unicode model selected, empty composer, menus closed. No native action process left pending.
