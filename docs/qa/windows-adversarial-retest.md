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
