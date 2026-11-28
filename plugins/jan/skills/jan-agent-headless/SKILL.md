---
name: jan-agent-headless
description: >-
  Run Jan Agent non-interactively for scripts and CI with jan cli agent run:
  model and provider overrides, safety flags (--safe, --sandbox, --plan),
  turn and budget limits, worktrees, resuming sessions, JSON output parsing
  and exit codes. Use when automating coding tasks with Jan Agent or
  reading its results programmatically.
---

# Jan Agent in scripts and CI

Reference: `docs/src/pages/docs/agent/cli.mdx` and the other pages in
`docs/src/pages/docs/agent/`.

`jan` alone opens the interactive console; `jan cli agent run` is the
headless form.

```bash
jan cli agent run "fix the failing test in tests/auth"
jan cli agent run --project ~/code/app --model <id> "update the changelog"
jan cli agent run --output-format json "review auth.rs" | jq -r .result
```

## Safety defaults

Tool calls are auto-approved and shell commands are not sandboxed by
default. For unattended runs pick deliberately:

- `--safe`: approval before writes, shell commands and MCP tool calls
- `--sandbox`: OS confinement for shell commands (bubblewrap, Seatbelt,
  AppContainer); `--allow-escalation` lets sandbox escapes through
- `--plan` (console): read-only
- `--worktree`: work in a dedicated git worktree, not the checkout
- `[tools] deny` in config is a hard deny that never lifts

## Bounding a run

| Flag | Effect |
|------|--------|
| `--max-turns N` | Hard cap; exits `53` if the model is still calling tools |
| `--max-budget-usd X` | Stops on spend; exits `0`. Models without published prices are refused |
| `--max-session-tokens N` | Advisory only; does not stop or compact |

There is no turn cap by default, so always set `--max-turns` or
`--max-budget-usd` in CI.

## Output and exit codes

- `--output-format text|json|stream-json`; with `json`, stdout holds one
  object (`result`, `is_error`, `stop_reason`, `error.code`, `session_id`,
  `num_turns`, `usage`) and diagnostics go to stderr.
- `stop_reason`: upstream finish reason, `budget_exceeded`, or `error`.
- Exit codes: `0` done (including budget stop), `1` failure, `2` bad
  arguments, `53` turn limit.
- `usage.cached_tokens` `null` (not reported) differs from `0` (cold cache).

## Sessions and providers

- Resume with `--resume=<id>` (use `=`, since `run` takes a positional
  task) or `-c`; `--fork-session` branches instead of continuing.
- `--provider`, `--api-key`, `--base-url` override the provider for one
  run; `--base-url` requires `--provider`.
- `--host-tools file.json` declares client-executed tools (called as
  `host__<name>`); `--host-gate` lets the host approve them.
