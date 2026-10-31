# Adversarial UI and flow audit

## Status

Follow-up to PR #9516, based on commit `0cee6f005` plus working-tree fixes. Source fixes and independent follow-up verification complete; this is **not a fresh native Windows/Linux pass**. Windows ARM retest is being prepared separately using Claude only. Suspension investigation is tracked separately in jan-internal #501 and is not a code change here.

## Audit coverage

Independent agents reviewed UI/accessibility, supported creation/navigation/persistence flows, assistants/projects/skills/MCP settings, Windows close lifecycle, and OAuth detection. Follow-up agents reviewed the fixes. Representative existing screenshots were actually read for alignment/menu layering observations; source findings are distinguished from native reproductions.

## Confirmed findings and remediation

| Area | Finding | Remediation / verification status |
| --- | --- | --- |
| Window close | Tauri JS close listener invokes destroy, but main capability permitted close only | Narrow main-caller destroy permission; real installed Tauri JS API/IPC-contract regression. Native Windows retest outstanding. |
| OAuth detection | rmcp resolves absent metadata as successful LegacyEndpointFallback; success alone falsely implies OAuth | Require discovered metadata; 21 offline OAuth tests and CLI-feature clippy passed. Original Windows fixture protocol failure remains unverified. |
| Cowork project move | Sidebar updated mirror, not authoritative session; later save/old-project deletion could undo move/delete wrong conversation | Shared authoritative project assignment/removal; focused project/history/persistence tests. |
| Skills scope | Last Cowork folder made global creation inaccessible | Explicit Global/current-folder destinations; stable open scope, dirty-draft discard guard, origin-directed edits. |
| Skills async editor | Same-scope late reads/save completions could overwrite newer editor selection | Generation guards and save/navigation locking; focused tests. |
| Assistant CRUD | UI could report success despite failed persistence; stale default/assignment IDs | Await persistence, preserve failing drafts, reset in-memory default; defined fallback without overriding explicit None. Existing conversation snapshots retained. |
| Composer assistant support | Cowork offered ineffective assistant selection; callback Chat was initially over-gated by first fix | Explicit support prop; normal Chat retains menus/shortcuts, Cowork hides unsupported controls; None+single-assistant choices tested. |
| Toggle/radio accessibility | Web/Browse checked state absent; mode radio keyboard behavior missing | Checkbox/pressed semantics; roving focus and arrow/Home/End behavior. |
| MCP settings | Failed disconnect/settings write left misleading state; reconfigure could drop edited config | Awaited operations, rollback preference/error feedback/live refresh, single reconfiguration operation, async dialogs, skip already-offline transports. |
| Sampling | Late save could target new current thread; pending changes dropped | Captured thread/assistant identity, immediate drafts and serialized/coalesced writes. |
| Cowork submit | Refused model/session submission cleared text/files | Synchronous acceptance result, unavailable read-only guards, handoff attachment recovery. |
| Active close | Final flush omitted active turn/partial wire history | Quiesce active runs before flush; retain partial stream history; prevent close on failure and allow retry. Real-storage failure, deferred startup/dispatch, partial tool arguments, strict native cancellation, timeout and second-close retry regressions passed. |

## Recommendations, not completed features

- First-turn Plan and Cowork-native MCP configuration need explicit product/runtime contracts; Chat tool controls must not imply Cowork support.
- Narrow composers can hide inline active icons; checked menu state remains accessible, but an unobtrusive active-controls summary could improve discoverability.
- Preview expansion remains bounded, not true maximize.
- Long-content, screen-reader, measured contrast and native hit-testing require further platform coverage; automated DOM tests are not visual proof.

## External blockers

- Windows ARM runtime reconnected, but the paired client still lacks desktop control. A fresh host-local Claude-only session is being prepared; no new native retest is claimed yet. Earlier report (26 pass / 2 fail / 2 blocked) used an older snapshot; its Close/MCP findings informed source investigation.
- Linux paired desktop control remains denied.
- Docs website built successfully in CI; Cloudflare preview deploy failed because CLOUDFLARE_API_TOKEN was unavailable. No documentation-source fix indicated.

## Final validation

- Full web regression: **363 suites / 4,810 tests passed** (`adversarial-final-tests.log`).
- Full web ESLint, TypeScript project build and `git diff --check`: passed (`adversarial-final-{lint,types}.log`).
- Offline OAuth detector suite: **21 tests passed**; CLI-feature clippy passed.
- Final narrow lifecycle/persistence review approved; reviewer independently ran **127 focused tests**.
- Completed settings/project/composer groups reviewed independently; follow-up findings (offline MCP edits, wrong-thread sampler writes, callback assistant gating, explicit None, closed-dialog Skills scope) fixed and regression-tested.
- Persistent storage failure prevents close; a 5-second unconfirmed tool/startup cancellation also prevents close and permits retry. This does not guarantee recovery after forcible termination or disk failure.
- The earlier macOS native matrix predates these source fixes. No native Windows close/ACL, auth fixture or new scope-selector success is inferred from JS tests.

Logs and synthetic fixtures are retained under `/tmp/jan-ui-matrix-qa/`; no real credentials/inference/external MCP were used for these tests.
