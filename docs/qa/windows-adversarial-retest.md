# Windows ARM current-fixes adversarial retest — 2026-10-31

## Incremental disposition: readiness in progress, no current-source native pass

- Fresh Orca runtime: `2f8bd397-518a-478f-bb2e-8223d8c7e4a0`, saved environment `win-arm`. Old runtime terminal handles were not reused.
- Fresh capabilities advertise Windows native screenshots/tree/input through `orca-computer-use-windows` 1.0.0. **Paired `computer.permissions` still returns `forbidden`: this paired client lacks `desktop-control`.** No paired native input, re-pairing, permission change, shell UI fallback or remote approval attempted.
- Rediscovered old Jan terminal `term_02f6a406-8ce4-4f05-9d67-01720b7b8c66` is an idle PowerShell shell, not a running local QA agent. Old baseline `windows-native-current-20261031` and its reported 26 PASS / 2 FAIL / 2 BLOCKED are stale context, not evidence for current fixes.
- Normal Orca `agent launch` returned `agent_launch_replay_unsupported`. Created a new normal installed Codex terminal, `term_92536dca-0c7f-498a-bad5-263ec2527617`, process ID 8392, title `Windows current fixes native QA readiness`. No bypass or global configuration flags used. Its local read-only native grant verification is pending; accepted prompt receipt alone is not proof of execution or permission.
- Parent reports production source frozen including Page-close strict-cancellation and Skills-scope changes; final review/explicit transfer approval still pending. **No source snapshot, transfer or build started.** Ask parent before declaring snapshot-ready.

### Claude-only correction

User subsequently required **Claude only** on Windows. The newly launched Codex readiness terminal `term_92536dca-0c7f-498a-bad5-263ec2527617` was interrupted and closed by exact handle (`ptyKilled=true`); no unrelated historical session touched. It had performed discovery only, no source build/transfer, and reported no Jan window. Its unsupported local permission endpoint was not claimed as screenshot authorization.

Installed Claude Code is **2.1.316**, actual executable `C:/Users/James/.local/bin/claude.exe`. Orca `terminal create --command claude` unexpectedly injected its preset `--dangerously-skip-permissions`; that exact new terminal `term_64cdb8e3-b315-4f86-a4e8-e9ad02404357` was immediately interrupted and closed (`ptyKilled=true`) without task input. To avoid this preset and the shell's `claude` function, launched the executable directly with ordinary `--permission-mode default` in rediscovered PowerShell terminal `term_02f6a406-8ce4-4f05-9d67-01720b7b8c66`. Claude readiness/native read verification remains pending. No bypass flags requested or approved.

## Final snapshot captured after explicit parent approval

- Captured 2860 source files (tracked + nonignored untracked, mutable `docs/qa/` excluded), base HEAD `0cee6f00545e05b3738283b3a8f0c5f533e96498`. Parent reported full 4810 tests/363 files, ESLint and TypeScript PASS; these are parent automated results, not native evidence.
- Archive `/tmp/jan-windows-adversarial-final/source.tar.gz`, SHA256 `74ca6a4cc3af50303015df26a48f4fc2e2fc1380de59754100a1ac04d1fc1fc5` (241948401 bytes).
- Manifest `/tmp/jan-windows-adversarial-final/source-manifest.json`, SHA256 `f7b57e7927f6f21ce4db0fafa3a8e1f975f64651370f50ffda44a7fea854badb`; embedded as `QA-SOURCE-MANIFEST.json`.
- Owned transfer server `http://100.64.0.101:18769/`, PID **85000**, restricted tailnet bind. No transfer/build yet: parent requires successful Claude local native read verification first. Parent may provide equivalent pushed commit; compare production file hashes before substitution.

## Concrete Claude blocking question (not answered)

Ordinary direct Claude is running in `term_02f6a406-8ce4-4f05-9d67-01720b7b8c66`, manual/default permissions. It loaded computer-use skill and performed workspace listing, then stopped at this PowerShell gate:

> Resolve Orca CLI executable and env names
> `"ORCA_CLI_COMMAND=$env:ORCA_CLI_COMMAND"; "ORCA_DEV_REPO_ROOT=$env:ORCA_DEV_REPO_ROOT"; (Get-Command orca -ErrorAction SilentlyContinue).Source; Get-ChildItem env: | Where-Object Name -like 'ORCA*' | Select-Object Name | Format-Table -HideTableHeaders`
> Command contains subexpressions `$()`
> Do you want to proceed? **1. Yes / 2. No**

No remote answer, bypass, or further input sent into this approval UI. Parent notified user and subsequently instructed work to stop while local approval is pending. User must inspect/resolve locally; paired desktop-control is independently forbidden. **Claude native screenshot authorization remains unproven.** Parent reports final source committed/pushed as `d2b5f4254`; production source unchanged from the approved captured snapshot. No remote fetch/transfer/build performed.

## Planned current-source checks (not executed)

Fresh exact dirty-source manifest/archive after parent freeze; verify remote hashes before building. Isolate `JAN_E2E_NO_KEYRING=1`, Jan data/folder, HOME/USERPROFILE, APPDATA/LOCALAPPDATA, WebView data and runtime/tool roots. Reuse only inventoried scoped toolchain/build resources, never old source as current. No global installs, secrets, real inference, installed Jan data or name-based kills.

| Target | Status |
|---|---|
| Native Close and `core:window:allow-destroy`, no ACL denial | PENDING final source/build/local authorization |
| Active/background synthetic stream close, question/partial/tool durability after reopen | PENDING |
| Global skill editing/scope switching/reopen | PENDING |
| Real loopback streamable MCP auth fallback fixture | PENDING |
| Menus/projects/tools native flows | PENDING |
| Selected light/dark 1024/1280/1600 screenshots, explicitly read | PENDING |

Save-error automated coverage is not native evidence. No native screenshots captured/read in this retest yet; **0 current-source native cases passed**.

## Resumed Claude matrix — live observation (2026-10-31, incomplete)

This supersedes the earlier readiness-only state above, not the evidence limitations.
Read-only terminal monitoring of the same Claude terminal confirms the Windows-local
Claude session has progressed to native project/thread and skill probes. Its last
printed aggregate was **17 PASS / 1 FAIL / 4 BLOCKED / 8 PENDING (30 cases)**;
these are **provisional agent-reported dispositions**, not independently reviewed
native passes. The specific failed/blocked cases and full evidence inventory have
been requested and remain uncollected at this checkpoint.

- Evidence/runtime roots reported by Claude:
  `C:\Users\James\orca\workspaces\jan\audit-artifacts\windows-adversarial-20261031`
  and `C:\Users\James\orca\workspaces\jan\audit-runtime\windows-adversarial-20261031`.
- Observed native accessibility actions include project creation/rename, thread
  assignment/move (case 21), and project deletion (case 22). Claude reports preserving
  probe files and hashing unrelated data before deletion. Full results still need
  review. Global-skill save/scope checks were active at observation time.
- WebDriver `wd.ps1 exec` is also present in the transcript. Native-vs-script
  evidence must be classified per case; scripted invocations are not native UI PASS.
- This matrix is the **d2b5f4254 baseline**, not proof of current source containing
  `a39250384` or the current dirty attachment changes. Exact build/source provenance
  has been requested; no rebuild/fetch or interruption was requested.
- No screenshots were opened by this monitoring agent. Claude has been asked to
  enumerate the screenshots it actually opened/read, not merely saved.
- Paired remote desktop control remains forbidden. Monitoring used terminal reads
  and one queued normal message only: no Windows desktop input, approvals, signals,
  permission changes or competing QA agent were used.

Completion evidence still required: exact FAIL/BLOCKED details, actual native Close
process exit and active-stream/question/partial/tool durability after reopen,
OAuth product-vs-fixture classification, global skill edit/scope/reopen results,
all remaining cases, and screenshot review inventory. **This is not a completed
Windows QA report.**

### Verified remote evidence-file checkpoint (matrix still running)

Read `build-manifest.json`, `cases.json`, and `report-notes.md` through a separate
read-only PowerShell terminal, `term_a548f3bb-1661-4f88-8468-41f6d48ba12b`. The
raw terminal response is retained locally at `/tmp/windows-qa-evidence-terminal.json`.
The remote source root is
`C:/Users/James/orca/workspaces/jan/windows-native-adversarial-20261031`.
The manifest confirms the archive/manifest SHA256 values recorded above, 2860
source files and zero post-build source changes. Binary SHA256:
`f7950446bc231d28f454e3b5c46795812ff51b263aa096e273835ab9a7ee3bc7`.
Native build: `cargo build --locked --manifest-path src-tauri/Cargo.toml --features e2e --bin Jan-Desktop`.
Frontend uses parent-approved external QA channel override `0.8.8-nightly-QA`;
engine resources are stubs, **not production-engine proof**.

**Exact current failure — case 27 (OAuth Add dialog):** valid RFC 9728 PRM/RFC 8414
AS fixture metadata is discovered correctly and returns `NEEDS_AUTH`. However,
Add MCP Server → Save shows a raw `NEEDS_AUTH`/rmcp transport error in a generic
Error modal plus inline alert; `reconfigureServers` rolls the entry back, leaving
it absent from `mcp_config.json`. The long error widens the dialog until Cancel/Save
scroll out of view. An inactive entry seeded through JSON, then toggled natively,
correctly shows “needs authentication / Sign in to this server to connect.” Thus
this is an **Add-dialog product-path failure, not failed OAuth fixture discovery**.
No credentials/tokens stored. Evidence names: `mcp-oauth-result.png`,
`mcp-oauth-after-err.png`, `mcp-qa-oauth-on-result.png`, `mcp-qa-oauth-card.png`,
`mcp-oauth-applog.txt`, `mcp-qa-oauth-on-applog.txt`.

**Exact current blocked cases — 1, 2, 7, 8:** dark/light 1600px sidebar open/closed
native visual coverage. Display 2880×1800 at 200% provides only 1440 CSS px; the
rightmost ~160 CSS px, including caption controls, captures blank off-screen.
DOM measurements confirm requested 1600×800/no horizontal overflow, but do not
replace native visual proof. 1024/1280 variants are reported read and PASS.

**Durability limits:** case 16 is Chat-only, loopback 40-chunk/750ms stream; navigation
away at chunk 4, return after ~20s, all 40 chunks persisted in `messages.jsonl`.
Cowork/agent-loop durability was intentionally not exercised because `dirs::home_dir()`
can still resolve the real profile despite env isolation. Cases 14/15 (actual native
Close/process exit and active close durability) remain pending at this checkpoint.

**Other observations (not promoted to new pass/fail cases):** project deletion
leaves “Project Not Found” instead of redirecting and an orphan zero-byte project
DB. A newly created assistant without emoji has a blank avatar. Minimized WebView2
keeps `document.visibilityState="visible"`, so visibility-hidden flush does not fire.
Native maximize/restore/minimize was exercised; minimize recovery used scoped
`SW_RESTORE` because the provider cannot enumerate minimized windows.

**Remote incident disclosure:** Claude reports a manifest-step invocation of rustup
without scoped `RUSTUP_HOME` auto-installed a fresh ~1.6GB toolchain into the real
`C:\Users\James\.rustup`; it reports removing that newly created directory and
confirming absence, with no pre-existing contents, `.cargo` or PATH changes. Build
itself used the scoped toolchain. See remote `incidents.log`; this monitoring agent
has not independently inspected cleanup. A yarn key-order change was restored
byte-for-byte from archive; final source rehash reports 0/2860 differences.

Claude's evidence policy states kept PNGs were opened/read, 25 unread PNGs deleted,
and non-Jan foreground captures discarded. This is remote-agent attestation, not
an independent local screenshot review. Continue to report that distinction.

### Artifact recovery and independent screenshot read

Downloaded the following existing remote artifacts without desktop input to
`/tmp/windows-qa-evidence/`: `cases.json`, `QA-REPORT.md`, `report-notes.md`,
`build-manifest.json`, `mcp-oauth-result.png`, `mcp-oauth-after-err.png`, and
`mcp-qa-oauth-on-result.png`. Transfer was artifact-only HTTP PUT over the scoped
local tailnet receiver (allowlisted filenames and 3 MB limit), not a remote
permission bypass or source/build change.

This monitoring agent **opened/read** `mcp-oauth-result.png` and
`mcp-oauth-after-err.png`. The former visibly shows generic Error → “Something went
wrong”, raw NEEDS_AUTH/rmcp transport text, and “Please check the parameters according
to the tutorial.” The latter visibly shows Add MCP Server with long red raw error,
a horizontal scrollbar and **no visible Cancel/Save footer**. This independently
confirms the visual portion of case 27; credential/config rollback evidence remains
remote-agent/file reported.

Latest checkpoint: **18 PASS / 1 FAIL / 5 BLOCKED / 6 PENDING**. Case 23 Global
skills is now reported native PASS: explicit global scope, new skill via UIA,
isolated `AppData/Roaming/Jan/data/agent-workspace/skills/qa-global-skill/SKILL.md`,
close/reopen, edit GAMMA-23 → DELTA-23 and save reflected in file/list. Case 24 Folder
scope is BLOCKED: Folder scope requires an attached live Cowork session, whose
mount calls `agent_subagent_list` → `dirs::home_dir()` → real user subagent path.
No unsafe real-home read was attempted to turn that into a pass. Matrix remains
in progress; native Close cases still require definitive completion evidence.

## Completed baseline matrix disposition — 2026-10-31 16:22 +07:00

**21 PASS / 2 FAIL / 7 BLOCKED / 0 PENDING**, as recovered from final remote
`cases.json`. This completes safe baseline disposition, **not all requested native
coverage** and **not verification of later source changes**.

- **FAIL 15: ordinary Chat partial response lost on native Close.** Native Enter
  submitted the synthetic OMEGA-15 prompt using `qa-slow-adversarial`; before Close,
  `c15-midstream.png` shows chunks 1–12 of 40 and active red Stop. Native caption
  Close UIA element 18 exited owned PID 32220 about 1.1s after click (30–39ms after
  click response). Fixture records client-aborted-stream at `09:17:39.018Z` and
  cleanup completed. The 304-byte `messages.jsonl` contains **only the user prompt**.
  Relaunch run3 PID 12152, native sidebar reopen, shows prompt only, **no partial
  assistant text or interrupted/stopped marker**. Thus clean exit is not durability.
  This monitoring agent independently opened/read both `c15-midstream.png` and
  `r3-thread2.png`, plus synthetic messages and events. Cowork question/tool/partial
  durability remains BLOCKED by real-home isolation, not inferred from Chat.
- **PASS 14: idle native caption Close actually exits.** Native Close element 18
  on run3 PID 12152 at `16:21:41.612+07:00`; click OK and exact PID exited at
  `16:21:42.785+07:00`, 30ms after click response. Agent reports MCP/llama.cpp/app
  cleanup log completion and no remaining Jan process. This proves idle exit only.
- **FAIL 27:** genuine OAuth Add dialog error/rollback/overflow described above.
- **BLOCKED 1/2/7/8:** 1600 CSS native capture beyond physical display extent.
- **BLOCKED 24/29/30:** folder skills, previews, artifact open/overlay require
  CoworkPage and forbidden real-home reads. Library shell search/filter is partial
  native evidence, not artifact-open/overlay proof.

### Pass scope and unexecuted subcases

Reported PASS IDs: **3–6, 9–14, 16–23, 25–26, 28**. Interpret by actual scope:

- Case 16 is Chat background-stream completion only, not Cowork run durability.
- Case 18 covers Plus/theme/sampling/thread/project menus and Escape focus return;
  **Plan submenu subcase is BLOCKED**, Cowork-only. Do not call all menus passed.
- Case 28 covers model search/selection, QA version label, reasoning correctly
  absent for the loopback custom provider. **Positive reasoning-effort submenu
  subcase is BLOCKED**: built-in provider UI has no safe base-URL override and would
  require external keyed traffic. Do not call positive reasoning UI passed.
- Case 23 proves explicit Global create/edit/save/reopen only. Folder/global scope
  switching remains blocked as case 24, not implied by Global success.

### Recovered completion evidence

`/tmp/windows-qa-evidence/` now also contains `case14-events.log`,
`case15-events.log`, `process-events.log`, `c15-fixture-events.jsonl`,
`c15-midstream-tree.txt`, `c15-midstream.png`, `case15-messages.jsonl`,
`native-run2-stdout.log`, `r3-open2.json`, `r3-thread.png`, `r3-thread2.png`, and
updated `cases.json` / `QA-REPORT.md`. All message content recovered is synthetic.
The exact native run3 cleanup stdout was reported by Claude, not yet recovered.

Baseline omissions remain `a39250384` and subsequent dirty attachment/Escape and
MCP fixes. Parent is investigating/fixing cases 15 and 27. **No rebuild or retest
was started while this baseline was active.** A subsequent delta retest must state
its own exact source hashes and cannot overwrite this baseline history.

Claude's final terminal summary confirms baseline completion at 16:23 +07:00 and
attests **65 kept PNGs, each opened/read**, with unread/occluded captures discarded.
This monitoring agent independently read four: OAuth error modal, OAuth inline
error/footer overflow, active Chat chunks 1–12, and reopened prompt-only thread.
Artifact receivers were stopped after transfer (owned local PIDs only); Windows
Claude and its local fixture were not interrupted. Final baseline summary has
been delivered to the parent; later-delta retest remains a separate authorization.


## Final-source delta retest staging — 2026-10-31

Baseline history above is preserved. The same Windows-local Claude terminal
`term_02f6a406-8ce4-4f05-9d67-01720b7b8c66` completed baseline disposition and
reports no remaining QA app processes. Its completed summary was read before
sending a QA-only delta plan. No second agent or paired desktop input is used.

**Source gate:** waiting for parent-provided final pushed commit SHA. No fetch,
source transfer, rebuild or relaunch is authorized before that exact SHA arrives.
Current dirty working-tree files are not a frozen source artifact.

Scoped retest acceptance:

- **15:** slow loopback Responses stream, actual native caption Close mid-stream,
  exact PID exit, then native reopen of thread; partial assistant content and
  stopped/interrupted state must persist. Read screenshot and synthetic durable
  messages; a clean process exit alone is insufficient.
- **27:** genuine OAuth metadata fixture added through native Add dialog must
  remain saved inactive and offer Sign in/needs-authentication without raw error
  overflow. Footer remains visible. Genuine protocol/transport failure must not
  be misclassified as OAuth. No sign-in or external credential flow is required.
- Menu/attachment visual deltas only if the exact-source build is ready promptly.
  Idle Close14 and the full 30-case baseline do not need repetition.

Use a new source snapshot and isolated app/profile/keyring/WebView roots, retaining
baseline evidence and reusing only inventoried scoped toolchain/build caches.
Record commit, production-file hashes, version override, binary hash and native
input versus WebDriver setup. Every retained native screenshot must be read.
Cowork real-home isolation cases remain BLOCKED; no workaround, approvals,
permission changes, bypasses or process-name kills are authorized.

**Delta results: PENDING exact-source authorization and build.**


### Exact source authorized; transfer started

Parent authorized final pushed commit
`2fff5e640d2df340d085af094f3b9209735b4cd9` (`2fff5e640`), verified with
`git rev-parse` and fork branch `git ls-remote`. Parent states production source
is frozen and local automated tests are 4857 tests / 366 files PASS, lint and
TypeScript PASS; these are not Windows native results.

Generated snapshot using **git archive of that exact commit**, not working-tree
bytes, excluding mutable `docs/qa/` only:

- `/tmp/jan-windows-delta-2fff5e64/source.tar.gz`, 242119356 bytes, SHA256
  `f34d0b08d0bb17c8df0f55b5b91590e6f85b5ed9fb714d85e031c4d2f7545b89`.
- `/tmp/jan-windows-delta-2fff5e64/source-manifest.json`, SHA256
  `5962ff5806386361c6f6c861ea5b103db2dcf131bfb14e4269c716c619419406`,
  **2865 files**, embedded as `QA-SOURCE-MANIFEST.json`.
- 32 changed/added file hashes versus baseline approved snapshot, comparison at
  `/tmp/windows-delta-evidence-2fff5e64/delta-source-comparison.json`.

Transfer uses scoped HTTP at tailnet-only `100.64.0.101:18775`, allowlisted source
GET and prefixed evidence PUT (8 MB per artifact). Claude preflight reports no
real-profile rustup directory; download has started into new
`C:/Users/James/orca/workspaces/jan/audit-runtime/delta-2fff5e64/download`.
Remote archive/all-source verification and build are still pending at this
checkpoint. No current-source Windows case is yet reported passed.


### Remote exact-source verification complete

Claude reports successful download (`curl1=0`, `curl2=0`), both archive and
manifest SHA256 values matching, successful extraction (`tar=0`), exact full
commit in manifest, and **all 2865 source files hash-verified**. The 2866th file
on disk is the embedded manifest, itself byte-identical to the downloaded
manifest. New source root:
`C:/Users/James/orca/workspaces/jan/windows-native-delta-2fff5e64`.
Build/native results remain pending. The stopped-state native UI expectation is
the existing **Continue** action on a stopped partial reply plus durable
`metadata.stopped: true`; no literal “stopped” label is assumed.


### Cached isolated build running

Remote comparison agrees: **32 frontend-only changed/added files**, no Rust
source changes. New target seeded by copying 8883 files / 12.9 GB; baseline
binary/target are preserved. Tool versions reported by scoped build:
`rustc 1.98.0` (Windows ARM64), `clang 19.1.5`, Node `v24.20.0`.

Initial PowerShell `-Steps` invocation treated the comma-separated steps as one
string and ran no build steps. Claude detected this from the subsecond build log
and corrected argument handling. The subsequent full scoped install → web →
incremental native e2e build is running. Robocopy exit 1 was correctly classified
as successful copy, not a source/build failure. No native result is inferred from
these setup events. Real-profile `.rustup` and `.cargo` remain absent per Claude.


### Full Windows build completed

Claude received authoritative background build **exit 0**. All frontend steps
had reported exit 0; post-build audit is restoring yarn's `web-app/package.json`
key-order rewrite from the exact archive before all-file rehash. This is the same
previously documented package-manager setup normalization, not an approved
product change. Isolated fixture/native D15/D27 remain the next priority.

Parent separately reports Ubuntu CI's SkillsDialog test clicked Delete while
Save was still busy; a test-only wait-for-enabled correction is being verified.
This does not change the Windows frozen production snapshot or establish a new
Windows UI regression. No Windows rebuild is requested for that test-only delta.


## D15 final-source native retest — PASS (independently reviewed)

Exact tested source is `2fff5e640d2df340d085af094f3b9209735b4cd9`.
Recovered `delta-source-verification.json`: **2865/2865 verified**, no failures,
embedded manifest identical. `delta-build-manifest.json`: **zero post-build source
differences**, Windows ARM64 e2e build, external version `0.8.8-nightly-QA`.
Binary 88559616 bytes, SHA256
`9bc56799ed32382ba414ccdb9d92cdd9c2d6b7827f2d41cfaeff66881ba314eb`;
frontend index SHA256
`23b5dd665913c67b95749809b2eb9ad12182a782f63b42b705673f8cd538853e`.
Engine resources remain stubs: this proves native UI lifecycle, not production
inference engines. Yarn 4.5.3; rustc 1.98.0 / clang 19.1.5 ARM64 / Node v24.20.0.

Actual native New Chat → model picker → synthetic prompt SIGMA-15 → Enter used
loopback `/v1/chat/completions`, 40 chunks paced 750 ms. Mid-stream screenshot
shows chunks 1–12, sidebar spinner and active red Stop. Native caption Close
(element 18) at **17:14:30.4067907 +07:00**; fixture aborted at
**10:14:31.123Z**; exact PID **6636** confirmed exited at
**17:14:31.2741658 +07:00**, about 0.87 seconds after click. Provider click returned
`accessibility_error` from `FromHandle` after destruction; correlated abort,
cleanup and exact-PID exit establish delivered Close, not a failed interaction.

Relaunch PID **15152**, native sidebar reopen: partial reply **chunks 1–14**
present, sidebar spinner cleared, play/Continue action visible. Durable assistant
message has status `ready`, 490 text characters and **`metadata.stopped: true`**.
Two chunks arriving after the mid-stream screenshot were also preserved.

This monitoring agent independently opened/read **both** `D15-midstream.png` and
`D15-reopened.png`, plus event log, synthetic message JSONL, fixture events,
source verification and build manifest at `/tmp/windows-delta-evidence-2fff5e64/`.
Thus baseline FAIL15 is resolved for ordinary Chat. Cowork durability remains
blocked and is not inferred. **D27 is still in progress at this checkpoint.**


## D27 core Add/overflow checks — independently reviewed

Native Add MCP Server → HTTP → loopback OAuth fixture → Save now closes without
an error modal and saves `qa-oauth` **inactive**. Recovered config entry:
`type: http`, `url: http://127.0.0.1:65095/oauth/mcp`, `active: false`, empty
command/args/env. Screenshot `D27-oauth-card.png` independently opened/read:
off toggle, **Auth: not authenticated**, **Sign in** visible. Read-only state:
no dialogs, `rawInPage: false`, switch unchecked. No literal “needs authentication”
card label is claimed; Sign in and the existing not-authenticated badge are shown.

Fixture requests independently read: initialize + RFC9728 protected-resource
metadata + RFC8414 authorization-server metadata. Backend app log contains
explicit `NEEDS_AUTH` after discovery; it is no longer exposed as a UI error.
No authorization/register/token exchange or stored credentials were used.

Non-OAuth malformed-content fixture remains a generic Error, **not OAuth**.
Independently opened/read `D27-malformed-result.png` (wrapped transport details,
Cancel/Copy visible) and `D27-malformed-dialog.png` (wrapped inline transport
error, **Cancel and Save fully visible**, no horizontal overflow). Read-only DOM
measurements agree: dialogs width 672 CSS px, scrollWidth=clientWidth=670, both
footer actions inside dialog and viewport. Failed malformed entry was not saved.
Technical transport details remain verbose by design; bounded display is the
acceptance target, not removal of legitimate non-OAuth diagnostics.

Harness note: initial state fields `rawNeedsAuth`/`rawInPage` used a broad raw-error
regex including rmcp, so true on malformed transport details does **not** mean
literal `NEEDS_AUTH`. Complete text and screenshots contain no OAuth marker for
this control; coordinator requested literal-marker clarification in final output.
Plain401/badmeta controls and final disposition are still being completed.


## Final scoped Windows delta disposition — 2 PASS / 0 FAIL

**D15 PASS; D27 PASS** on exact production source
`2fff5e640d2df340d085af094f3b9209735b4cd9`.
This resolves both baseline failures; it is **not a rerun of all 30 cases**.
Baseline remains historically **21 PASS / 2 FAIL / 7 BLOCKED**. Seven blockers
remain blocked, including unsafe real-home Cowork paths; no workaround attempted.
Optional menu/attachment sweep was deliberately omitted to finish the two targets.

D27 controls completed: malformed content, plain HTTP401 without valid OAuth,
and invalid OAuth metadata all remain **ordinary errors**, with no literal
`NEEDS_AUTH`, no Sign in flow, and failed entries absent from saved config.
The badmeta error's phrase “Auth required” is technical transport text, **not**
the explicit OAuth marker. Add footer actions remain inside viewport/dialog;
scrollWidth=clientWidth=670 CSS px for both Add and Error dialogs at 1200×800.
This agent independently opened/read **all ten recovered PNGs**: D15 midstream
and reopened; D27 OAuth result/card; malformed, plain401 and badmeta modal/dialog
pairs. Parent also independently reviewed the critical reopened/card/footer views.

Native actual input drove prompt/model selection/Close/reopen and MCP Add form
entry/Save/dismissal. WebDriver was restricted to setup/scroll and read-only
assertions; none of those scripted actions are promoted to native behavior proof.
Missing WebDriver session after relaunch and a PowerShell interpolation parser
error were test-harness issues corrected without product changes. Broad raw-error
flags in early state JSON are mislabeled; complete text/literal-marker checks and
screenshots establish classification, not those broad booleans.

Cleanup reported by Windows-local Claude:
- Native caption Close exited owned Jan **PID15152** at
  **17:22:46.4435405 +07:00**.
- Exact owned loopback fixture **PID2976** stopped at
  **17:22:46.5120424 +07:00**; its resulting exit255 is termination, not test failure.
- Baseline evidence hash comparison: **0 changed lines**.
- Real-profile `.rustup` and `.cargo`: both absent.
- Cleanup wrapper exited1 despite completed recorded cleanup; no unverified
  blanket cleanup success is inferred from wrapper status alone.

Credential evidence is limited to synthetic fixture traffic (no token/register
exchange) and saved OAuth entry (empty env, inactive). An attempted wider isolated
profile scan encountered locked temp files, so it is **not an exhaustive credential
scan**. No real credentials or real-data Cowork run was used.

Recovered evidence root: `/tmp/windows-delta-evidence-2fff5e64/`; remote evidence:
`C:/Users/James/orca/workspaces/jan/audit-artifacts/windows-adversarial-delta-2fff5e64/`.
`delta-build-manifest.json`, `delta-source-verification.json`, synthetic disk/events,
config entry and all screenshots are retained. The source is 2865/2865 hash-verified
with zero post-build production differences. Report/artifact transfer completion
is recorded below separately; baseline above is never replaced.
