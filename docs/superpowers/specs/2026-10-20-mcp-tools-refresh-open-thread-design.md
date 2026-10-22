# MCP tools refresh in open threads — design

Date: 2026-10-20
Base: Jan v0.8.7 (`web-app`)
Branch: `fix/mcp-tools-refresh-open-thread`

## Problem

With Smart Tool Routing enabled (the default, `web-app/src/hooks/useMCPServers.ts:49`),
each chat thread's `CustomChatTransport` freezes its routed MCP tool list for the
lifetime of the transport (`web-app/src/lib/custom-chat-transport.ts:860-865`,
`:1103-1138`). The freeze key is

```
{ servers: <enabled server names, sorted>, disabled: <disabled tool keys, sorted> }
```

The key uses *enabled* server names (from `get_server_summaries`, which lists
enabled servers whether or not they are connected). It therefore does not change
when:

1. an enabled server connects after the thread sent its first message (slow
   `npx` start, OAuth, backoff reconnect);
2. a server restarts or reconnects with a different tool list;
3. a server changes its tools at runtime;
4. more than 5 servers are enabled and a server was not picked for the first
   routed message.

In all four cases the open thread keeps sending the stale list. A new thread gets
a new transport, which is why users are told to "start a new thread".

The backend already emits `mcp-update` on every connect, reconnect, health-check
failure, deactivate and restart. The frontend handler in `useTools`
(`web-app/src/hooks/useTools.ts`) only clears the orchestrator's cache and
updates the global store; it never touches the per-thread frozen list. The
effect in `use-chat.ts:110-117` calls `refreshTools()` when tool names change,
but with routing on that call returns the frozen list because the key is
unchanged.

## Goal

An open thread must pick up tools from an MCP server that connects, restarts or
changes its tool list after the thread was opened. The routed tool set (and so
the cached prompt prefix) must still only change when the server state actually
changes, never on every turn.

## Non-goals

- No Rust changes. `notifications/tools/list_changed` stays unhandled; case 3
  above is covered only when the server reconnects (which emits `mcp-update`).
- No change to the routing threshold (`ROUTING_THRESHOLD = 5`) or the routing
  heuristic. Case 4 is improved only in that a later `mcp-update` triggers a
  re-route; the re-route still picks servers from the latest user message.
- No persisted per-thread tool snapshot.

## Design

### 1. `CustomChatTransport.invalidateFrozenTools()`

File: `web-app/src/lib/custom-chat-transport.ts`.

```ts
/** Drop the frozen routed tool set so the next refreshTools() re-routes. */
public invalidateFrozenTools(): void {
  this.frozenRoutedTools = null
  this.frozenRoutedSig = ''
  this.toolsGeneration++
}
```

Generation guard: `refreshTools()` captures `this.toolsGeneration` when it
starts and writes `this.tools` and the freeze only if no invalidation happened
meanwhile, so a refresh superseded by a later invalidation discards its result.
The routing heuristic itself is unchanged. Because the key is recomputed on the next
`refreshTools()`, a re-route happens exactly once per `mcp-update`; subsequent
sends with the same key reuse the new frozen list as before.

### 2. `useTools` propagates `mcp-update` to every session transport

File: `web-app/src/hooks/useTools.ts`.

In the `setTools` function (it runs on mount and on `SystemEvent.MCP_UPDATE`,
but only the `mcp-update` handler passes `invalidateSessions: true`; mount
leaves existing freezes alone), after `mcpOrchestrator.invalidateCache()` and
after the store update, iterate over `useChatSessions.getState().sessions` and for each
session call

```ts
session.transport.invalidateFrozenTools()
void session.transport.refreshTools()
```

Rationale: `use-chat.ts` only holds a ref to the *active* thread's transport,
and its effect only fires when tool *names* change. Going through the session
store reaches every open thread, including background ones, and fires on every
`mcp-update` regardless of whether names changed.

`refreshTools()` wraps every await in its own `try/catch`, so it does not
throw. On a failure it still rebuilds `this.tools`, minus the tools whose load
failed (see Error handling). The loop still wraps each session in a
`try/catch` so an unexpected exception from one transport cannot stop the
others.

### 3. `use-chat.ts` effect invalidates before refreshing

File: `web-app/src/hooks/use-chat.ts:110-117`.

The effect (deps `[mcpToolNames, ragToolNames]`) keeps the previous names in a
`useRef` and calls `invalidateFrozenTools()` then `refreshTools()` only when
the name sets actually changed; it does nothing on mount.

This keeps the existing name-change path correct on its own, so the fix does
not depend on event ordering between `useTools` and `use-chat`.

### Error handling

If `getServerSummaries` or `getRelevantTools` throws inside `refreshTools()`,
the error is caught and logged, and `this.tools` is rebuilt without MCP tools
while the freeze stays cleared, so the next send re-routes. If the
orchestrator's `getTools` fails it returns `[]`, and that empty list is frozen
until the next `mcp-update` (or tool-name change). Invalidation alone never
throws.

### Prompt-prefix stability

The frozen list is cleared only on `mcp-update` or a tool-name change, i.e.
only when server state changed. Between such events the behaviour is identical
to today. A server that flaps (health-check failure, reconnect) will cause two
re-routes; this is accepted since the tool set genuinely changed in between.

## Testing

Unit tests with Vitest (`cd web-app && yarn test`), Node only, no Rust needed.
Existing transport tests to pattern after:
`web-app/src/lib/prompt-cache-toolcall.test.ts`.

New tests:

1. `custom-chat-transport` — with routing enabled and a mocked `mcpService`
   returning a fixed summary list:
   - two consecutive `refreshTools()` calls with the same key call
     `mcpOrchestrator.getRelevantTools` once (freeze works);
   - after `invalidateFrozenTools()`, the next `refreshTools()` calls it again
     even though the key is unchanged.
2. `useTools` — with two sessions in `useChatSessions`, emitting
   `SystemEvent.MCP_UPDATE` calls `invalidateFrozenTools` and `refreshTools`
   on both transports.
3. `use-chat` effect — when `mcpToolNames` changes, `invalidateFrozenTools` is
   called before `refreshTools` (can be covered by a spy on the transport).

Manual verification in the built app is optional and requires the Windows
toolchain (Rust, VS Build Tools, LLVM, Ninja, CMake, Yarn, Make), which is not
installed on the development machine. Scenario, if run: open a thread, send one
message, then enable or restart an MCP server in Settings; the next message in
the same thread must have the new tools available.

## Files touched

- `web-app/src/lib/custom-chat-transport.ts` — add `invalidateFrozenTools()`.
- `web-app/src/hooks/useTools.ts` — loop over sessions on `mcp-update`.
- `web-app/src/hooks/use-chat.ts` — invalidate before refresh.
- New test files next to the above.
