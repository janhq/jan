# Full bounded native UI round — 2026-10-31

## Method / isolation
Exclusive native operator, Jan PID **20020**, WD 4447. Existing isolated incognito/keyring-off fixture `/tmp/jan-ui-matrix-qa`. No inference, sends, provider validation or real data edits. WD restricted to fixture setup, geometry and read-only diagnostics. All tested interactions use native Orca targeted to exact PID with restore-window. Screenshots and matching AX JSON: `/tmp/jan-ui-matrix-qa/full-*.{png,json}`; screenshots explicitly read before disposition. Source frozen. Prior partial reports are context, not new-round passes.

## Bounded pairwise cases (disposition updated incrementally)
| ID | Case | Status | Evidence / observations |
|---|---|---|---|
|01|Dark home Chat at 1200|PASS|`full-dark-chat.png` read: native mode click selected Chat, folder/suggestions hidden, stable footer/model alignment.|
|02|Dark home Cowork / folder pill|PASS|`full-dark-home-cowork.png` read: native New Chat after Dark theme, Cowork selected; folder/project pill above composer, footer single line; actual attached folder in dark thread.|
|03|Light home Chat at 1200|PASS|`full-light-home-chat.png` read: native theme Light selection, New Chat selected; white composer/light border/footer aligned.|
|04|Light home Cowork / folder pill|PASS|`full-plus-light.png` read: native Cowork switch exposes folder/project pill above composer and suggestions; plus menu opens below without collision. Attached folder tested in thread `full-html-card.png`.|
|05|Composer plus menu active controls|PASS (Plan/workspace; tools unavailable)|`full-thread-controls-open.png` read: actual Cowork plus Upload/Add folder/Add project/Assistant/Plan. Home intentionally fewer rows. No Tools row in this fixture; runtime tool invocation excluded.|
|06|Plan toggle / reopen state|PASS|`full-plan-reopened.png` read: coordinate selected Plan then reopened plus; checked Plan, icon-only active composer shortcut. No send.|
|07|1024 composer hidden controls in plus|PASS (Plan/workspace; tools unavailable)|`full-narrow-plus.png` read: actual1024×800 dark native plus opened via AX focus+Space; footer never wraps, but width does NOT hide Plan. Companion1200 docked preview narrows composer: `full-hidden-plan-plus.png` read proves active Plan shortcut hidden, plus still exposes checked Plan. At1024 preview is modal and hides composer. Separate tools entry absent in fixture.|
|08|Light reasoning select + reopen|PASS|`full-light-medium-reopen.png` read: High→Medium native coordinate selection, reopen parent+submenu Medium checked; effort submenu geometrically overlaps HTML above iframe.|
|09|Dark reasoning overlap preview|PASS|`full-dark-reasoning-overlap.png` read: native menu+effort submenu over actual HTML boundary, Medium check retained, dark opaque surface correctly above iframe.|
|10|Model settings modal open / dismiss|PASS open/dismiss; fields BLOCKED|`full-model-settings.png` read: native footer opens Model Settings gpt-5.2 right modal with proper backdrop/title/Close. Empty fixture settings, parameter editing unavailable.|
|11|Project create assigned assistant save|PASS|`full-project-assistant-open.png`, `full-project-created.png` read. Typed unique synthetic name, coordinate-selected long Reviewer, clicked Create. New sidebar/project page and assigned reviewer visible; no clipping. Post-fix native new QA Postfix Assigned + QA Editor Create→Edit reopened exact name/assignment (`full-postfix-created-reopen.png` read).|
|12|Project reopen assignment + edit persistence|PASS|`full-project-edited-reopen.png` read. Opened project Edit, renamed to QA Matrix Round Project Edited, changed assignment to QA Editor, Update, navigated New Chat then project and Edit: edited name and Editor retained. Post-fix WD refresh (setup only), native edit to Final → Update → Edit retained Final and Editor: `full-project-postfix-reopen.png` read. Save failure path covered by parent's targeted unit tests, not injected natively.|
|13|Assistant synthetic edit/save/reopen light|PASS|`full-assistant-reopened.png` read: native renamed synthetic Reviewer→QA Reviewer Matrix Edited, Save, reopened Edit; exact new name and original instructions/temperature retained, clean light modal.|
|14|Assistant dark editor/parameter menu|PASS|`full-dark-parameters.png` read: native dark Reviewer Edit→coordinate Add parameter menu, disabled existing Temperature, aligned help ellipsis/scrollable groups, correct modal stacking; Escape dismissed.|
|15|Skill new global save/read|BLOCKED|`full-true-global.png` read: New Chat + WD refresh still restores current Cowork workspace; no native global-scope selector. Fixture-only imported store currentId=null acknowledged but live UI remained folder scope (likely separate HMR module instance); refused to call folder creation global. New folder skill CRUD passed16/17; genuine global create/save/read not established.|
|16|Skill edit/save/reopen|PASS (folder)|`full-skill-exact-reloaded.png` read: synthetic folder skill created, body replaced, saved, selected other row then reselected: round-three body retained. Native injection converted triple hyphens to em dash (confirmed disk); content-format fidelity NOT passed and not attributed to application.|
|17|Existing project skill scope|PASS (folder context)|`full-skill-exact-reloaded.png` read: workspace path and folder badge, global fixtures alongside. New Chat preserves current Cowork folder; global scope requires separate setup, not conflated.|
|18|MCP synthetic inactive ON native coordinate|PASS|`full-mcp-on.png` read: native scrollbar drag/scroll eventually exposed rows; read-only WD rectangles located switch. Coordinate (1138,449) activated qa-inactive, green dot, orange ON switch and success toast. Only safe Python fixture.|
|19|MCP OFF round trip + dark rows|PASS|`full-mcp-off.png` read: same native coordinate OFF, gray switch/dot and AX 0. Qa-Fixture remains enabled, Jan Browser remains OFF. Dark rows readable/aligned.|
|20|HTML preview open light|PASS|`full-html-card.png` read: native artifact-card AXPress opens actual offline HTML; title toolbar and 480px panel aligned. Open subbutton coordinate attempts did not open; card worked.|
|21|Markdown preview open|PASS|`full-md.png` read: native summary card opens Markdown heading, paragraph and formatted table; toolbar intact.|
|22|CSV preview open|PASS|`full-csv.png` read: native metrics card opens exact CSV as readable plain text (not table); correct filename.|
|23|SVG preview open|PASS|`full-svg.png` read: native diagram card opens SVG graphic; original 640px graphic scrolls horizontally in 480px pane, scroll bar visible; no toolbar clipping.|
|24|Preview toolbar overflow|PASS|`full-preview-overflow.png` read: native toolbar overflow offers Open/Show in Folder, aligned above SVG; Escape dismisses. OS external-open actions excluded.|
|25|Preview expand / restore|PASS bounded expansion|Sidebar hidden natively enables usable expansion. `full-expanded-settled.png` / `full-collapse-settled.png` read; native expand→collapse produces720→560px panel, verified read-only DOM bounds+AX. At sidebar-visible1200 max480, expansion can be geometric no-op; not fullscreen maximize.|
|26|Preview close / reopen / Escape|PASS close/reopen + compact Escape|Native Close coordinate then report card reopen succeeded. `full-1024-escape.png` read proves Escape closes compact modal preview. Desktop Escape leaves docked panel open (`full-close-reopen-escape.png` read), expected nonmodal behavior.|
|27|Preview keyboard splitter resize|PASS|`full-splitter-narrow.png` read: native click splitter focuses it; two Right keys change AX width480→448 and visually move divider. Left at max480 unchanged. No native drag resize claim.|
|28|1024 actual native compact preview|PASS|WD setWindowRect setup returned1024×800; `full-1024.png` read: native PNG2048×1600, compact modal preview fills remaining784px with complete toolbar/SVG; splitter disabled in overlay by design. Escape closes.|
|29|1200 restore geometry dark preview|PASS|WD geometry restored1200×800; `full-dark-preview1200.png` read (2400×1600 native): native dark theme return and HTML card reopen,448px docked preview and composer aligned.|
|30|Dark skills saved editor / layering|PASS|`full-skill-exact-reloaded.png` read: native save/reselect, selected row icon/name truncated without action collision; dark modal/editor/footer clear.|

## Scope limits
Representative bounded matrix, not exhaustive Cartesian product. Runtime inference, external MCP, OS variants and application restart persistence excluded. Fixture/provider limitations and failed native attempts will be named, never counted as passes.

## Fixes and final automated validation

- Fixed premature project-save success/reset: await persistence, retain drafts after errors, guard duplicate submits/dismissal; Home caller propagates rejection. Native success paths retested after the patch; deferred/rejected paths covered in unit tests.
- Fixed cross-folder skill draft retargeting: scope-keyed state isolates late reads and drafts; independent review approved both fixes.
- Final full web regression: **355 suites / 4,670 tests passed**. Full ESLint, TypeScript build, and `git diff --check` passed.
- Logs: `/tmp/jan-ui-matrix-qa/full-round-postfix-tests.log`, `full-round-postfix-lint.log`, `full-round-postfix-types.log`.
- Nothing committed. This round verifies the local macOS native UI, not a new Windows/Linux release pass.

## Final disposition / evidence limits
- **30/30 cases dispositioned: 29 PASS with named subcase limits, 1 BLOCKED (15 global skill creation). No confirmed new production visual defect; no source edits by tester.** This is not 30 unrestricted passes.
- Case10 parameter-editing subcase BLOCKED by empty synthetic model-settings schema, while modal open/dismiss passed. Cases05/07 separate tools-menu entry unavailable in fixture; Plan/workspace controls passed, actual tools runtime excluded.
- Native1024/1200 dimensions verified with screenshots after WD geometry setup; no claim of native window drag resize. Keyboard splitter resize and actual bounded expand720→560 verified natively. Expand is not fullscreen maximize; sidebar-visible1200 max480 can be a no-op.
- Global skills blocker was attempted through native New Chat/reopen, setup refresh, and fixture-only currentId reset; UI continued to label folder scope. It is not a production defect diagnosis.
- Skills Markdown hyphens underwent native/macOS smart substitution; disk confirms em dash and initial duplicate body from type-text. Corrected to single round-three body before save/reselect; frontmatter parsing/fidelity is not passed.
- Parent source fixes landed at explicitly permitted safe boundary: async project saving/error handling and scope-keyed skills state. After single setup reload, project native new-create/reopen and edit/reopen passed; source-level failure/scope-race tests reported by parent, not counted as native tests.
- No inference, sends, external provider validation, external MCP, destructive actions, commit or process signals. qa-inactive left OFF, Jan Browser OFF. Final app dark1200×800 home with Skills dialog showing folder/global rows; exact PID20020.
