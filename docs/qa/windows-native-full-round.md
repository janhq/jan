# Windows native full bounded round — 2026-10-31

## Current disposition: BLOCKED native screenshot verification / pending local-agent interaction, NOT a Windows UI pass

**Final handoff for this dispatch:** paired native permission is explicitly denied; local-agent screenshot authorization remains unproven. The existing local agent has a pending question and rejects further status prompts with `agent_prompt_blocked`. No screenshots have been read, no native matrix cases passed. User must inspect the exact pending interaction locally; no remote approval or bypass attempted. Preserve remote work. Do not wait for this report as if QA completed.

- Source workspace: `/Users/james/orca/workspaces/jan/merge-chat-cowork`; base HEAD `9733e9416f939f65cfea4d0fc5f9d64724c3c3bc`, dirty source (including composer folder selector moved below, async project save and scoped skills fixes). HEAD alone is not the tested revision. Parent confirmed final folder-below tests **23/23 PASS** (`/tmp/jan-ui-matrix-qa/folder-below-tests-final.log`) and source freeze. Fresh snapshot/manifest captured after that confirmation; Windows build pending.
- Local agent reports baseline immutable install, plugin APIs, core, extensions and stable-channel frontend build passed; native e2e compilation remains running in a fresh target (latest visible compilation `genai`, `jan-utils`, `oauth2`). No completed native build or launch is evidenced. Parent subsequently changed the outlined workspace pill and composer consistency, with further projects/tools groups pending: **this baseline is superseded, not latest source**, and has not received those verified deltas.
- No current-source Windows executable launched. Previous `cowork-ui-launch-snapshot` reports/builds are stale context, not evidence for this round.
- Windows-only operator; no Linux access or changes. No installed Jan, real profile, global PATH changes, credentials, inference, broad process kills or permission changes.

## Fresh access checks

| Route | Observation | Disposition |
|---|---|---|
| Saved Orca `win-arm` | Runtime `bbccf6fc-0874-4899-9f7d-715ab38f5cf3`; provider `orca-computer-use-windows` 1.0.0 advertises native screenshot/tree/click/key support. Capabilities are not an authorization grant. | Discovery PASS only |
| Paired client's native authorization | `orca computer permissions --environment win-arm --json` returned `forbidden`: method needs `desktop-control`, not granted when paired. No native input attempted through that client. | **BLOCKED**, not passed |
| Existing local Windows agent | Fresh terminal discovery confirmed handle `term_22f4b1df-e8c1-4c65-b5aa-ba6a2c75e4e5` live. Local capability/permission queries succeed without desktop-control denial; Windows permission endpoint reports accessibility/screenshots unsupported rather than positive grant. Requested read-only native app-state verification before input. Explicitly prohibited remote safety approval, re-pairing, shell UI automation and stale-source reuse. | Local native observation check pending; no input pass yet |
| SSH x64 `win` | SSH works, OS reports X64. `query user` reports `No User exists for *`; independent `Get-Process explorer` returns no rows. git/cargo/rustc/node/yarn available; no Orca executable discovered on PATH. | **BLOCKED** native desktop; build tools inventoried, no current build |

Discovery commands ran against Windows hosts only. Local Orca agent schema saved at `/tmp/windows-qa-orca-context.json` (not screenshot evidence). No screenshots captured or read in this round yet.

## Fresh source handoff / build readiness

- Snapshot `/tmp/jan-windows-native-round/source.tar.gz`, SHA256 `2361245c07a833ab1e460f3109f3f503b48e546c85d6b811d4c6f73d3c3d98b6`.
- Per-file manifest `/tmp/jan-windows-native-round/source-manifest.json`, SHA256 `3cadbd175a9ad49366cb6a76f727bc3316d4816a7797875dbaa292ae917b4b27`, embedded as `QA-SOURCE-MANIFEST.json`. Includes tracked and nonignored untracked files, excluding `docs/qa/` reporting output. This captures dirty source, not merely HEAD.
- Transfer endpoint `http://100.64.0.101:18764/` owned server PID **51469**; no public/global installation. Exact PID only on cleanup.
- Requested NEW destination `C:/Users/James/orca/workspaces/jan/windows-native-current-20261031`, never overwriting stale snapshot. Remote report target `C:/Users/James/orca/workspaces/jan/audit-artifacts/windows-native-current-20261031/QA-REPORT.md`.
- Local agent inventoried existing isolated Rust/Cargo 1.98.0, ARM64 clang 19.1.5, Node 24.20.0, Yarn 4.5.3, MSVC and Windows SDK. Completed native compile/launch unverified. Local agent created disposable state/four synthetic files/30 pending cases. None counts as native UI evidence.
- Concrete communication blocker: urgent read-only native screenshot request rejected twice with `agent_prompt_blocked`, durable request ID `ed8ca149-c049-45db-9c6d-e1ada28b0689` (second attempt used required retry ID). Terminal title `[ ! ] Action Required`; visible `Queued follow-up inputs / ? 1 question / shift+← to answer`. Exact pending question body was not exposed by bounded terminal output; do not speculate it is a permission or approve it remotely. Ask local user to inspect it.
- Remote terminal remains `term_22f4b1df-e8c1-4c65-b5aa-ba6a2c75e4e5`. Preserve compile/work; no stop/kill performed. No polling monitor remains. Transfer server PID51469 retained for later coordinated final deltas.
- Outlined pill two-file delta (6 tests/lint parent PASS) and composer six-file delta (75 tests parent PASS, `/tmp/composer-consistency-delta.patch`) are **not applied remotely**. Parent requested package after additional menus freeze. Do not represent baseline manifest as covering those changes. Rebuild/retest final verified delta before any latest-source claim.

## Planned bounded matrix — not executed

Each case requires the fresh current-source isolated build, actual native input, screenshot capture **and explicit image read**, plus named fixture limitations. Six representative layouts: light/dark at 1600/1280/1024. No real credentials or inference; synthetic fixture and loopback services only. Application state, WebView user data, keyring (`JAN_E2E_NO_KEYRING=1`), runtime and tools isolated under QA siblings; exact owned PIDs recorded and stopped only by PID.

| ID | Case | Status |
|---|---|---|
|01|Light 1600 Chat/Cowork home + folder selector below composer|BLOCKED — authorization/current build pending|
|02|Dark 1600 Chat/Cowork home + folder selector below composer|BLOCKED — authorization/current build pending|
|03|Light 1280 composer footer/layout|BLOCKED — authorization/current build pending|
|04|Dark 1280 composer footer/layout|BLOCKED — authorization/current build pending|
|05|Light 1024 composer and menus|BLOCKED — authorization/current build pending|
|06|Dark 1024 composer and menus|BLOCKED — authorization/current build pending|
|07|Native caption minimize/restore/maximize controls|BLOCKED — authorization/current build pending|
|08|Chat/Cowork toggle actual clicks|BLOCKED — authorization/current build pending|
|09|Composer plus/menu layering|BLOCKED — authorization/current build pending|
|10|Plan toggle + reopen persistence|BLOCKED — authorization/current build pending|
|11|Assistant switch/list layering|BLOCKED — authorization/current build pending|
|12|Assistant edit/save/reopen light|BLOCKED — authorization/current build pending|
|13|Assistant edit/save/reopen dark|BLOCKED — authorization/current build pending|
|14|Project create + assistant assignment save/reopen|BLOCKED — authorization/current build pending|
|15|Project edit save/reopen (awaited persistence)|BLOCKED — authorization/current build pending|
|16|Global skill create/save/reselect|BLOCKED — authorization/current build pending|
|17|Folder skill edit/save/reselect|BLOCKED — authorization/current build pending|
|18|Skill scope switching/draft isolation|BLOCKED — authorization/current build pending|
|19|Synthetic loopback MCP/tools enable|BLOCKED — authorization/current build pending|
|20|Synthetic MCP/tools disable round trip|BLOCKED — authorization/current build pending|
|21|Settings/model settings open/dismiss|BLOCKED — authorization/current build pending|
|22|Model/reasoning/settings menus layering|BLOCKED — authorization/current build pending|
|23|HTML preview native open/light layering|BLOCKED — authorization/current build pending|
|24|Markdown preview|BLOCKED — authorization/current build pending|
|25|CSV preview|BLOCKED — authorization/current build pending|
|26|SVG preview|BLOCKED — authorization/current build pending|
|27|Preview overflow menu above content|BLOCKED — authorization/current build pending|
|28|Preview expand/collapse/splitter|BLOCKED — authorization/current build pending|
|29|1024 compact preview Escape/close/reopen|BLOCKED — authorization/current build pending|
|30|Dark preview + menu overlap and return home|BLOCKED — authorization/current build pending|

**Current counts: 0 PASS, 0 FAIL, 30 BLOCKED (unexecuted prerequisites).** A concrete denied permission never counts as a successful UI test. This incremental status will be updated if the authorized local-agent path becomes available.
