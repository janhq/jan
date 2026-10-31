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

---

# Phase 2: UI cutover (Cowork runs on threads)

Findings from the code map: `HomeModeToggle`, `useHomeMode` and the first-prompt handoff do NOT exist in this branch (#500 lists them as done elsewhere), so they are built here. Cowork has no route params; the current session is `useCoworkSessions.currentId`. `routes/cowork.tsx` calls the store at ~15 sites; `NavCowork`, `artifacts.tsx`, `SkillsManagerDialog`, `coworkModelControls`, `coworkCommands` also read it.

## Decisions

### P2-1. Keep the `useCoworkSessions` API; change where it persists
- Public API and `CoworkSession` shape are unchanged, so the run driver (`runRequest`, `commitTurns`, ...) is untouched. Session id = thread id.
- Remove zustand `persist`/`backendStorage` for this store. Replace with write-through: a store subscriber diffs sessions by object identity and, per changed session, debounced (500 ms, flushed on app close/hide), writes the sidecar (`write_thread_extra`) and `thread.json` (title, updated in seconds, model, `metadata.{mode,folder,planMode,goal}`; spread existing metadata, never drop keys). Mutating one session never re-serializes another (#310).
- New session: `create_thread` with `id = session.id` and `metadata.mode = cowork` on first non-empty commit (empty sessions are never written; matches `pruneEmptySessions`). Delete: `delete_thread` + session-scope sandbox delete (also fixes the existing leak) + the monitor cleanup NavCowork already does.
- Hydration order at startup: (1) `migrateCoworkSessionsToThreads`, (2) hydrate store from cowork threads: thread.json for list fields and the sidecar for transcripts. All sidecars are read at startup in this phase because artifacts/diff views walk every turn; lazy per-session loading is a follow-up (noted, not hidden).
- Unsettled migration (marker unset after partial failure): hydration ADDS sessions from the old `code-sessions` blob whose id is not a committed thread (read adapter). The first mutation writes them through (idempotent `create_thread`). Nothing disappears from the UI because of a failed migration.
- `code-sessions` is no longer written after cutover; it is not deleted (rollback; removal is a later release). Rollback caveat (R8) is documented in release notes.
- Session-scope sandbox sweep runs only when `isCoworkMigrationSettled`, with keep-list = ids of cowork threads (+ unmigrated blob ids).

### P2-2. Routes: per-conversation Cowork URL
- Extract the body of `routes/cowork.tsx` into a container component taking `sessionId`; add route `/cowork/$sessionId` (guarded by `ensureCoworkEnabled`) that selects the session (`selectSession`) and renders it. `/cowork` becomes a redirect to `/cowork/<ensureCurrentSession()>` so every existing link (`NavCowork`, `artifacts`, `coworkCommands`) keeps working.
- `/threads/$threadId` for a `mode=cowork` thread redirects to `/cowork/$id` (search results, deep links, history).
- Unknown session id: redirect home. `routeTree.gen.ts` is regenerated by the router plugin, not hand-edited.

### P2-3. Home composer: Chat | Cowork selector (no separate toggle anywhere)
- `useHomeMode` (`chat` | `cowork`, in-memory, default chat) and `HomeModeToggle` rendered in the home `ChatInput`; hidden when `!isCoworkEnabled()`. Mode is locked by construction: after submit the conversation lives in its own view.
- Cowork mode: compact composer, "Add project or folder" control (maps to `session.folder`), "Ideas for you" from `CoworkEmptyState` examples. Plus-menu contents in Cowork mode: attachments only (plan mode stays in the Cowork view).
- Submit in Cowork mode: `startNewSession`, set model/folder, write a first-prompt handoff to `sessionStorage` (`cowork-initial-message:<id>`, same pattern as chat's `INITIAL_MESSAGE`), navigate to `/cowork/<id>`; the Cowork container consumes and removes it once and calls `runRequest`.
- Strings: `en` only now (other locales follow, listed as follow-up).

### P2-4. One sidebar history, no NavTabs
- Delete `NavTabs` and the route-based sidebar swap. `NavMain`, `NavProjects` and one "Chats and tasks" list always render. The list merges chat threads (not in a project) and cowork sessions, sorted by `updated`, with a mode icon per row; click navigates by mode. Running Cowork sessions keep their active indicator.
- Artifacts / Customize / Cowork settings entries move into the unified sidebar, shown when `isCoworkEnabled()`.
- Search includes both modes; cowork hits open `/cowork/$id`. Project views stay chat-only (open question 4, deferred). Bulk "delete all chats" still keeps cowork conversations.
- Channel gate stays `isCoworkEnabled()` (nightly/dev). Splitting it from a user setting for stable is a follow-up; data is always visible regardless (flag controls surface only).

## Out of scope (follow-ups)
Lazy transcript loading; favorites/pinning for Cowork; Cowork under Projects; non-English strings; channel-gate split; removing the `code-sessions` key and the unmigrated-blob adapter after 1-2 releases.

## Tests (phase 2)
- Store: write-through writes only the changed session; debounce coalesces; empty sessions never written; delete removes thread + sandbox; hydration from threads; hydration union with unmigrated blob; thread metadata is spread not replaced; hydration tolerates a corrupt sidecar (session skipped + logged, thread kept).
- Startup: migration runs before hydration; sweep gated on settled marker.
- Routes: `/cowork` redirect; unknown id redirect; cowork thread at `/threads/:id` redirects.
- Composer: toggle hidden when disabled; cowork submit creates a session, writes the handoff, navigates; handoff consumed exactly once.
- Sidebar: unified list shows both modes sorted; no NavTabs; click routes by mode; existing coworkGate/tabRestoration tests updated.

## Phase 2 review outcome: astra (approve with changes). Fable pending; its findings get appended below.
Adopted changes (override the P2 text above where they conflict):
- A1 Persistence protocol (P2-1): per-session serialized write queue; dirty state kept on failure and retried; `flush()` awaits queued AND in-flight writes; creation order stays sidecar-first, thread.json-last. Native quit (Cmd+Q, tray, window close) goes through an awaited flush handshake before exit.
- A2 Active runs commit only in `finally` (`useCoworkRun` holds live turns). Accepted limitation for this phase and stated in release notes; checkpointing is a follow-up.
- A3 Delete: tombstone + cancel pending write for that id, stop the session's run and monitors, then delete thread, sidecar and session sandbox, in that order. A late write for a tombstoned id is dropped.
- A4 "Never write empty sessions" applies to sessions never persisted. A persisted session that becomes empty (`/clear`, `dropFromTurn`, rewind) IS written.
- A5 Partial migration: sessions first written from the legacy blob keep `metadata.migratedFrom`. Deleting a session while migration is unsettled records its id in a `cowork_deleted_ids` backend setting that migration and the fallback union honour, so the blob cannot resurrect it.
- A6 Hydration: remove the store from `hydrateStores` `.persist.rehydrate()`; migration then hydration complete before routes render; write-through is suppressed during hydration. A stale `DataProvider` thread fetch must not replace newer entries or supply an obsolete sweep keep-list.
- A7 Model mapping: persisted thread uses `assistants[0].model.{id,engine}`; the adapter maps both directions. Write through the backend commands directly (not `DefaultThreadsService`, which swallows create errors and resets `created`).
- A8 `useThreads` owns thread-list entries: Cowork create/update/delete also upserts into `useThreads` (and its search index) so search sees them live.
- A9 Id collision with an existing chat thread: the legacy session stays visible as read-only "unavailable" with the files untouched; never overwrite. A corrupt sidecar likewise shows an "unavailable" row rather than hiding the session.
- A10 Channel policy: if Cowork is disabled on the channel, Cowork conversations are listed and openable read-only (no new runs); the route guard allows viewing. Wording "data is always visible" kept, now consistent.
- A11 Routing: a wrapper resolves mode/readiness BEFORE mounting the chat `ThreadDetail` (loader/wrapper, not an effect inside it); distinguish "not hydrated" from "unknown id". The URL is authoritative: Cowork handlers take the session id from the route, not `ensureCurrentSession()`. Internal `createSession()` (budget notice) navigates.
- A12 First-prompt handoff: attachments are transferred by session id through an in-memory map (not sessionStorage); text goes through sessionStorage; consumed only after `runRequest` accepts, with duplicate-send protection; a stale handoff for an unpersisted session is discarded on load.
- A13 Sidebar: active row derives from the route; mixed s/ms `updated` normalised before sorting; running first-turn sessions get a row; artifacts pending-preview handoff tested through the new redirect.
- A14 Extra tests: reordered/failed/retried writes, mutation during flush, delete during pending write and active run, clear-to-empty, crash between sidecar and thread.json, partial-migration delete+restart, collision/corrupt sidecar rows, cold deep link during hydration, refetch racing a write, back/forward and rapid switching, background run commits to its own session, handoff (attachments, rejected submit, reload, duplicate effect), search index sync, disabled-channel read-only.

## Phase 2 review outcome: fable (approve with changes)
Adopted (in addition to A1-A14):
- F1 BUG in the plan: a write-through thread without `migratedFrom` makes `migrateCoworkSessionsToThreads` fail on that id forever (marker never set, sweep never runs). Fix both ways: stamp `migratedFrom` on write-through creates of legacy-sourced sessions AND relax the migration skip rule to "existing thread with the same id and `mode === 'cowork'` is already migrated". Test: migration after write-through settles.
- F2 Flush mechanism is named, not assumed: Tauri window `CloseRequested` handler awaits `flush()` before closing, plus `beforeunload`/reload best effort. The 500 ms debounce is a new loss window versus today's per-`set()` persist, so keep it short and flush on `visibilitychange` hidden too.
- F3 `write_thread_extra` must not create the thread directory for a thread that has no `thread.json` outside migration/first commit; delete cancels the id's timer (see A3). Rust: add `create` flag defaulting to false; migration and first commit pass true.
- F4 Make `create_thread`/`modify_thread` writes atomic (tmp + rename) in Rust, and make hydration treat a dir with a valid sidecar but broken `thread.json` as recoverable (visible "unavailable" row, files kept, sandbox kept in the sweep keep-list).
- F5 One loader: cowork hydration reads the same `list_threads` result as `DataProvider` (shared retry path), not a second fetch.
- F6 `thread.json` writer is a read-modify-write that spreads existing metadata, bypasses `DefaultThreadsService`, and preserves `created`. Rename/todo/goal changes bump `updated`.
- F7 `currentId` was persisted; keep it by storing it in a backend setting (`cowork_current_id`) so cold start still resumes the last session.
- F8 `/cowork` redirect must not mutate the store in `beforeLoad` before hydration; hydration MERGES with sessions created in the meantime.
- F9 Container extraction keeps the route-param and `currentId` in lockstep: the container sets `currentId` from the route on mount and all helpers read the route id.
- F10 `/threads/$id` for an unknown-mode thread waits on the thread-list load or does a direct `get_thread` read before choosing a view.
- F11 Enumerate `isCoworkRoute` consumers before deleting NavTabs; copy chat's StrictMode-safe handoff consumption.
- F12 Extra tests: migration after write-through, delete during pending write (no dir resurrection), close-requested flush, crash between sidecar and first thread.json, `/threads/:id` before list load, cold-start currentId, StrictMode double-consume.

## Implementation order (each step committed and tested separately)
1. Rust: atomic thread.json writes; `write_thread_extra` create flag; tests.
2. TS: relax migration skip rule (F1); cowork persistence module (write queue, tombstones, flush, hydration, model mapping) + tests, not yet connected.
3. Connect: swap persist for the persistence module in `useCoworkSessions`, wire migration then hydration at startup, sweep gating, close handler.
4. Routes + container extraction, thread redirect.
5. Home selector + handoff, unified sidebar, remove NavTabs.
