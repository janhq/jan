# Native isolation QA — 2026-11-02

Scope: macOS arm64, e2e build only. No installed app/profile contents inspected,
modified, copied, or symlinked. No external credentials or inference model used.

## Evidence

- Independent source verifier approved the locked Tauri/Wry chain before launch;
  independent reviewer found no blockers. Requested ACL regression coverage was
  added: shipped creation allow before configuration, both creation commands
  denied afterward for main and auxiliary labels.
- `yarn build:e2e:app` passed. Root `yarn lint`, e2e immutable install,
  `yarn test:unit` (82 tests), and e2e `yarn typecheck` passed.
- Rust e2e isolation/keyring tests: 2 passed. E2e all-target clippy with
  `-D warnings` and production all-target cargo check passed. Cargo still emits
  existing dependency warnings in agent-tools (deprecated fetch_update and
  unnecessary unsafe); no unrelated fixes included.
- Fresh-root preflight passed before the first native launch. Native smoke
  passed, and the native first-run setup screen was visually inspected without
  clicking the engine/model download action.
- Two subsequent owned native processes reused only that disposable profile.
  Both passed all 4 smoke assertions: first-run UI, Rust-resolved data path,
  on-disk configuration, and localStorage freshness/reload persistence. The
  marker deliberately left by process one was absent in process two. This
  verifies process-lifetime browser storage, not persistent browser migration.
- The existing embedded harness retained its spawned child handles and performed
  cleanup. The recorded second probe app PID was absent after teardown. No
  name-based or port-based process killing was used.

- Rebased onto foundation `c831c103d` (documentation-only foundation advance),
  then repeated Rust tests, e2e clippy, production check, native build, all 82
  guard tests, typecheck and native smoke: passed. Recorded app PID was absent
  after the repeated run's owned teardown.

## Boundaries

The entire chat/migration/model suite was not run for this focused slice.
Backend migration semantics are unchanged. Auxiliary frontend webview creation
is intentionally denied in e2e; native screenshot creation remains ephemeral.
There is no filesystem/network sandbox or claim of before/after installed-profile
comparison. Windows known-folder gaps remain documented in README.

Repository-wide `cargo fmt --all -- --check` fails on extensive pre-existing
formatting differences; the new Rust isolation module passes rustfmt and
`git diff --check` passes. No mass formatting was applied.

See README for the source chain and reproducible fresh-root procedure. Local
raw logs/screenshots remain in temporary QA storage, not committed, because
screenshots include unrelated desktop background content.
