# Merge Chat + Cowork: data model and migration (phase 1)

Tracks janhq/jan-internal#500 (data/migration section) and #310 (one-blob session store).

## Product target
One home composer with a Chat | Cowork selector, one sidebar history, no NavTabs toggle.
Every conversation is a `Thread`; `metadata.mode` is `chat` (absent = chat) or `cowork`.
Mode is locked once the first message is sent.

## Current state (verified in code)
- Chat: `<jan_data>/threads/<id>/{thread.json,messages.jsonl}`. Rust `threads/commands.rs`; `metadata` is opaque pass-through.
- Cowork: zustand persist, key `code-sessions` (v1) in `<jan_data>/settings.json`, one blob. `CoworkSession` = id, title, model, folder, turns[], messages[] (AI SDK UIMessage), history? (deprecated), subagents, lastUsage, goal, todos, planMode, updated (ms).
- `create_thread` ALWAYS overwrites id with a new UUID (commands.rs:77). Id validation exists in threads/utils.rs (<=128, [A-Za-z0-9_-]).
- Sandboxes: threads -> `agent-workspace/threads/<id>`, cowork -> `agent-workspace/sessions/<id>`. Startup sweep (DataProvider.tsx) only sweeps the thread scope with live thread ids. Cowork delete does not delete the sandbox today.
- Cowork gated by `isCoworkEnabled()` (nightly/dev). Stable never wrote `code-sessions`.
- Precedents: `migrateLocalStorageSettings.ts` (backend-settings flag, retry on failure, never deletes source); Rust `store_migration.rs`.
- Thread `updated` is seconds, Cowork `updated` is ms. `updateThread` clobbers `created` on each update (existing bug, out of scope unless touched).

## Design

### D1. Storage shape of a Cowork thread
- `thread.json`: standard Thread fields + `metadata: { mode: "cowork", folder, planMode, goal?, migratedFrom?: { store: "code-sessions", updated } }`. `model` -> thread `model`/`assistants` (model-only assistant).
- Transcript payload (`turns`, `messages`, `subagents`, `lastUsage`, `todos`, `history`) goes in a per-thread sidecar `threads/<id>/cowork.json`, NOT `messages.jsonl`. Reason: UIMessage / CoworkTurn do not round-trip through `ThreadMessage` (turns have diffs, argsLive, subagent runs); lossless is the priority and #500 says verify round-trip first. Sidecar also fixes #310 (one file per session, list renders without transcripts).
- `messages.jsonl` stays empty for Cowork threads. CLI `jan cli threads` lists them; they show with no messages (acceptable, documented).
- New Rust commands: `read_thread_extra(thread_id, name)` / `write_thread_extra(thread_id, name, value)` restricted to an allowlist (`cowork`), atomic write (tmp + rename), per-thread lock reuse, id validated.

### D2. Thread id = session id
- `create_thread` honours a caller-supplied id if it passes the existing validator and the dir does not already exist (idempotent: if exists, return existing, do not overwrite). Absent/invalid id -> current behaviour (new UUID) so Chat is unchanged.
- Session ids are `crypto.randomUUID()` so they pass validation. Keeping ids keeps `sessions/<id>` sandbox linked.

### D3. Sandbox scope follows mode (must land before migration)
- Helper `workspaceScopeFor(thread)` -> `session` if mode=cowork else `thread`. Keep Cowork sandboxes in `sessions/<id>` (no file moves = no data-loss risk).
- Startup sweep: sweep thread scope with ids of chat threads, session scope with ids of cowork threads. Never sweep a scope with an empty keep-list (existing behaviour returns 0), and never sweep until thread list load succeeded.
- `deleteThread` cleans the right scope (fixes existing leak of cowork sandboxes).

### D4. Migration (one-time, idempotent, copy-not-move)
- Trigger: on startup after stores hydrate, if backend setting `cowork_threads_migrated_v1` is unset AND `code-sessions` blob has >=1 session. No sessions -> set marker, done (stable path: nothing to do, no writes).
- Per session: skip if thread dir with that id already exists (idempotent/resumable); else write sidecar FIRST, then thread.json LAST (thread.json is the commit marker; a half-written dir without thread.json is retried and overwritten). `created` = `updated` (no created in source); `updated` converted ms -> s.
- Marker set only when all sessions succeeded; on partial failure leave unset, retry next launch, log per-session errors, never throw into app startup.
- Never mutates or deletes `code-sessions` (rollback for 1-2 releases; removal is a later release). Old nightly builds keep working.
- Empty sessions (no turns) are skipped (matches `pruneEmptySessions`).
- Channel: runs on any channel but only when the blob exists; mode=cowork threads are hidden from Chat list/search while Cowork is unavailable (see D5).

### D5. Consumers tolerate `metadata.mode`
- Add `getThreadMode(thread)` util. Until the UI cutover, NavChats / SearchDialog / project views / deleteAllThreads filter out `mode=cowork` so nothing visible changes. Preserve metadata with spread on all writers (thread route already does).
- Rust/CLI `list_threads` unchanged (returns all).

### D6. Sequencing (decision for reviewers)
Phase 1 (this PR series): D2, D3, D1 commands, D5 filters, migration engine + tests, behind a function `migrateCoworkSessionsToThreads()`; NOT yet wired to startup, because the Cowork UI still reads/writes `code-sessions`; wiring migration early would create stale copies and dual-write drift.
Phase 2 (UI cutover PR): Cowork reads/writes threads, new composer selector, unified sidebar; wire migration at startup in the same release; `useCoworkSessions` removed after 1-2 releases.
Alternative: wire migration now and re-sync sessions whose `updated` is newer than `migratedFrom.updated`. Rejected: it is not "one-time" and risks overwriting thread-side edits.

## Review outcome (astra = openai/gpt-6-astra, fable = anthropic/claude-fable-5)
Fable: approve with changes. Astra: ran out of turns before a verdict; findings below are the ones it relayed. Changes adopted:
- R1 (fable) D4 skip rule keys on `thread.json` existence, never dir existence. A dir with `cowork.json` but no `thread.json` is re-migrated. Collision with an existing thread.json whose metadata.mode != cowork: log, leave marker unset, do not overwrite.
- R2 (fable) Session-scope sweep runs only when the migration marker is set (or no `code-sessions` blob). Migration runs strictly before any sweep in the same startup.
- R3 (fable, astra) D2 is NOT chat-neutral: web Chat always supplies a ULID, so honouring ids changes chat from backend UUID to ULID. Accepted knowingly (ULID passes the validator, which already names it) and tested. `temporary-chat` still bypasses persistence.
- R4 (fable) Migration reads the zustand persist envelope `{state:{sessions,currentId},version}` and must handle v0 sessions (no `messages`): rebuild via `coworkTurnsToUIMessages`, leave `history` as is.
- R5 (astra) `DefaultThreadsService.createThread` swallows errors and returns its input. Migration bypasses it and calls the backend commands directly, strict (throws).
- R6 (astra) CLI consumers (`find_resume_thread`, `resolve_resume`/`fork_thread`, `cli_save_thread` in core/cli/mod.rs) pick all modes. "No messages is acceptable" is insufficient: CLI resume/latest/fork must skip or reject `mode=cowork` threads with a clear message.
- R7 (astra) `list_threads` silently skips malformed thread.json; migration verifies by reading back, not by listing.
- R8 (fable) Rollback caveat: edits made to a cowork thread after cutover are invisible to a rolled-back build, and re-roll-forward does not re-migrate (marker set). Documented.
- Answers: sidecar yes; keep `sessions/` sandboxes; do not wire migration in phase 1; Projects deferred.
- Wording: setting the marker is a settings write.

## Tests
- Rust: create_thread with supplied id (valid, invalid, existing dir not overwritten, absent -> uuid); extra read/write allowlist, atomic, traversal rejected.
- Extra (from review): crash-recovery re-migrate, sweep gated on marker, v0 envelope, ULID chat regression, byte-for-byte sidecar round-trip, id collision leaves marker unset, corrupt sidecar still lists, CLI resume skips cowork threads.
- Vitest: migration (maps fields, ms->s, idempotent re-run, partial failure leaves marker unset, empty skipped, source blob untouched, no-blob sets marker), workspaceScopeFor, sweep keep-lists per scope, mode filters.
- Commands: `cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1 core::threads`; `yarn test:web`; `yarn lint`.

## Open questions
1. Sidecar vs messages.jsonl for Cowork transcripts?
2. Keep sessions sandboxes in `sessions/` or move to `threads/<id>` in phase 2?
3. Phase-1 not wiring migration: acceptable, or wire now with re-sync?
4. Should Cowork threads with a folder appear under Projects? (deferred)
