# MCP Tools Refresh in Open Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An open chat thread picks up tools from an MCP server that connects, restarts or changes its tool list after the thread was opened, without re-routing on every turn.

**Architecture:** `CustomChatTransport` keeps a per-thread frozen routed tool list keyed on enabled server names plus disabled tools. We add one public method that clears the freeze, and call it from the two places that already react to MCP state changes: the `mcp-update` listener in `useTools` (for every session in `useChatSessions`) and the tool-name effect in `use-chat`. The next `refreshTools()` then re-routes once and re-freezes.

**Tech Stack:** TypeScript, React 19 hooks, zustand stores, Vitest 3 with jsdom (`web-app/src/test/setup.ts` mocks the service hub). Yarn 4.5.3 via corepack. No Rust.

**Spec:** `docs/superpowers/specs/2026-10-20-mcp-tools-refresh-open-thread-design.md`

## Global Constraints

- Frontend only: no files under `src-tauri/` change.
- `frozenRoutedTools` must be cleared only on `mcp-update` or a tool-name change, never on every send (prompt-prefix stability, spec "Prompt-prefix stability").
- Routing heuristic and `ROUTING_THRESHOLD = 5` untouched.
- `refreshTools()` must keep its existing error behaviour: log and keep the last `this.tools` on failure.
- Commands run from Git Bash; repo root is `C:\Temp\jan-src`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. `mcp-update` arrives while a session's `refreshTools()` is already running (a send in progress). Expected: the in-flight send uses whatever list it already resolved; the next send re-routes. Covered by Task 2 test "invalidate during refresh does not throw".
2. A session exists in `useChatSessions` whose transport has `serviceHub === null` (tests, early startup). Expected: `refreshTools()` sets `tools = {}` and does not throw; other sessions still refresh. Covered by Task 3 test "one failing transport does not stop the others".
3. `mcp-update` with zero sessions open. Expected: no error. Covered by Task 3 test "no sessions".
4. Routing disabled (`enableSmartToolRouting: false`). Expected: `invalidateFrozenTools()` is a harmless no-op and tools still refresh live. Covered by Task 2 test "no-op when routing disabled".
5. Model without the `tools` capability. Expected: still no tools sent after invalidation (`modelSupportsTools` check runs before routing). Covered by Task 2 test "no tools when model lacks capability".

---

### Task 1: Test harness runs on this machine

**Files:**
- No source changes. Verifies `web-app` Vitest runs with Node only.

**Interfaces:**
- Produces: the command `yarn test:web` (repo root) runs the `@janhq/web-app` Vitest project.

- [ ] **Step 1: Enable Yarn 4.5.3 through corepack**

Run (Git Bash, repo root):
```bash
corepack enable && corepack prepare yarn@4.5.3 --activate && yarn --version
```
Expected: `4.5.3`

- [ ] **Step 2: Install dependencies**

Run: `yarn install`
Expected: finishes without error. If a native postinstall fails on a package unrelated to `web-app`, note it and continue; the next step decides whether it matters.

- [ ] **Step 3: Run one existing transport test**

Run: `yarn test:web -- src/lib/prompt-cache-toolcall.test.ts`
Expected: the file's tests PASS. If the run fails on resolving `@janhq/core`, run `yarn build:core` and retry.

- [ ] **Step 4: Commit nothing; record the exact working command**

Write the command that passed into `docs/superpowers/plans/2026-10-20-mcp-tools-refresh-open-thread.md` under this step, replacing this sentence, and commit:
```bash
git add docs/superpowers/plans/2026-10-20-mcp-tools-refresh-open-thread.md
git commit -m "docs: record web-app test command

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `CustomChatTransport.invalidateFrozenTools()`

**Files:**
- Modify: `web-app/src/lib/custom-chat-transport.ts:860-865` (fields), add method near `refreshTools` (`:1016`)
- Test: `web-app/src/lib/custom-chat-transport.frozen-tools.test.ts` (new)

**Interfaces:**
- Produces: `public invalidateFrozenTools(): void` on `CustomChatTransport`. Later tasks call it before `refreshTools()`.

- [ ] **Step 1: Write the failing tests**

Mock these modules (same import paths the transport uses):
- `@/hooks/useServiceHub` → `useServiceStore.getState()` returns `{ serviceHub }` where `serviceHub.mcp()` returns `{ getTools, getToolsForServers, getServerSummaries }` and `serviceHub.rag()` returns `{ getTools: async () => [] }`. `getServerSummaries` resolves `[{ name: 'fs' }, { name: 'gmail' }]`.
- `@/hooks/useMCPServers` → `getState().settings = { enableSmartToolRouting: true, useLightweightRouterModel: false, routerModelProvider: '', routerModelId: '' }`.
- `@/hooks/useModelProvider` → `getState()` returns `{ selectedProvider: 'llamacpp', selectedModel: { id: 'm', capabilities: ['tools'] } }`.
- `@/hooks/useToolAvailable` → `getState().getDisabledTools()` returns `[]`.
- `@/hooks/useThreads` → `getState().threads = {}`.
- `@/lib/mcp-orchestrator` → `mcpOrchestrator.getRelevantTools` is `vi.fn()` resolving `[{ name: 'list', server: 'fs', description: '', inputSchema: { type: 'object' } }]`; also mock `@/lib/mcp-orchestrator/mcp-orchestrator` to the same object.
- `@/lib/agentTools` → use `vi.importActual` and override `refreshMemoryDigest` with `vi.fn().mockResolvedValue(undefined)` (the transport also imports `getAgentToolSchemas`, `memoryDigestNow`, `sandboxEnforces`, `CHAT_AGENT_TOOL_NAMES` from it).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
// mocks as above, then:
import { CustomChatTransport } from './custom-chat-transport'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator'

describe('CustomChatTransport frozen routed tools', () => {
  beforeEach(() => vi.mocked(mcpOrchestrator.getRelevantTools).mockClear())

  it('reuses the frozen list when the key is unchanged', async () => {
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(1)
  })

  it('re-routes after invalidateFrozenTools() even though the key is unchanged', async () => {
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    t.invalidateFrozenTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).toHaveBeenCalledTimes(2)
  })

  it('invalidate during refresh does not throw', async () => {
    const t = new CustomChatTransport('sys', 'thread-1')
    const p = t.refreshTools()
    expect(() => t.invalidateFrozenTools()).not.toThrow()
    await expect(p).resolves.toBeUndefined()
  })

  it('is a no-op when routing is disabled', async () => {
    // set useMCPServers mock settings.enableSmartToolRouting = false for this test
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    t.invalidateFrozenTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).not.toHaveBeenCalled()
    // getTools from the mocked mcp service was called twice
  })

  it('sends no tools when the model lacks the tools capability', async () => {
    // set useModelProvider mock selectedModel.capabilities = []
    const t = new CustomChatTransport('sys', 'thread-1')
    await t.refreshTools()
    t.invalidateFrozenTools()
    await t.refreshTools()
    expect(mcpOrchestrator.getRelevantTools).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test:web -- src/lib/custom-chat-transport.frozen-tools.test.ts`
Expected: the second and third tests FAIL with `invalidateFrozenTools is not a function`; the first may pass.

- [ ] **Step 3: Implement `invalidateFrozenTools(): void` in `web-app/src/lib/custom-chat-transport.ts`**

Place it directly above `async refreshTools(`. Body: set `this.frozenRoutedTools = null` and `this.frozenRoutedSig = ''`. Add a one-line doc comment saying the next `refreshTools()` re-routes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test:web -- src/lib/custom-chat-transport.frozen-tools.test.ts`
Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add web-app/src/lib/custom-chat-transport.ts web-app/src/lib/custom-chat-transport.frozen-tools.test.ts
git commit -m "feat(web-app): add CustomChatTransport.invalidateFrozenTools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `useTools` propagates `mcp-update` to every session transport

**Files:**
- Modify: `web-app/src/hooks/useTools.ts` (inside `setTools`, after `updateMcpToolNames` / store updates)
- Test: `web-app/src/hooks/__tests__/useTools.mcp-update.test.ts` (new)

**Interfaces:**
- Consumes: `CustomChatTransport.invalidateFrozenTools(): void` (Task 2), `CustomChatTransport.refreshTools(abortSignal?): Promise<void>`, `useChatSessions.getState().sessions: Record<string, ChatSession>` with `session.transport`.
- Produces: on every `SystemEvent.MCP_UPDATE` (`'mcp-update'`), every session transport gets `invalidateFrozenTools()` then `refreshTools()`.

- [ ] **Step 1: Write the failing tests**

Mock `@/hooks/useServiceHub` so `getServiceHub().events().listen` captures the handler for `'mcp-update'` into a variable and `getServiceHub().mcp().getTools()` resolves `[]`, `getServiceHub().rag().getToolNames` resolves `[]`. Mock `@/lib/extension` (`ExtensionManager.getInstance().get` returns `undefined`) and `@/lib/mcp-orchestrator/mcp-orchestrator` (`invalidateCache: vi.fn()`). Use the real `useChatSessions` store and `useAppState`/`useToolAvailable` stores; seed `useChatSessions.setState({ sessions: {...} })` with fake transports `{ invalidateFrozenTools: vi.fn(), refreshTools: vi.fn().mockResolvedValue(undefined) }` cast to `CustomChatTransport`.

```ts
import { renderHook } from '@testing-library/react'
import { useTools } from '../useTools'
import { useChatSessions } from '@/stores/chat-session-store'

const fakeTransport = () => ({
  invalidateFrozenTools: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined),
})

it('invalidates and refreshes every session transport on mcp-update', async () => {
  const a = fakeTransport(), b = fakeTransport()
  useChatSessions.setState({ sessions: { s1: { transport: a } as any, s2: { transport: b } as any } })
  renderHook(() => useTools())
  await capturedMcpUpdateHandler()
  for (const t of [a, b]) {
    expect(t.invalidateFrozenTools).toHaveBeenCalledTimes(1)
    expect(t.refreshTools).toHaveBeenCalledTimes(1)
    expect(t.invalidateFrozenTools.mock.invocationCallOrder[0])
      .toBeLessThan(t.refreshTools.mock.invocationCallOrder[0])
  }
})

it('one failing transport does not stop the others', async () => {
  const bad = { invalidateFrozenTools: vi.fn(() => { throw new Error('boom') }), refreshTools: vi.fn() }
  const good = fakeTransport()
  useChatSessions.setState({ sessions: { s1: { transport: bad } as any, s2: { transport: good } as any } })
  renderHook(() => useTools())
  await expect(capturedMcpUpdateHandler()).resolves.toBeUndefined()
  expect(good.refreshTools).toHaveBeenCalledTimes(1)
})

it('does nothing with no sessions', async () => {
  useChatSessions.setState({ sessions: {} })
  renderHook(() => useTools())
  await expect(capturedMcpUpdateHandler()).resolves.toBeUndefined()
})
```

Note: `setTools` also runs on mount, so expect the mount call plus the event call if you assert totals; the assertions above count calls after the mount run (reset the fakes after `renderHook`, before invoking the handler).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test:web -- src/hooks/__tests__/useTools.mcp-update.test.ts`
Expected: first test FAILS (`invalidateFrozenTools` called 0 times).

- [ ] **Step 3: Implement the session loop in `web-app/src/hooks/useTools.ts`**

Import `useChatSessions` from `@/stores/chat-session-store`. At the end of the `try` block in `setTools` (after the store updates), add a helper `invalidateSessionTools()` in the same file:

```ts
function invalidateSessionTools(): void {
  for (const session of Object.values(useChatSessions.getState().sessions)) {
    try {
      session.transport.invalidateFrozenTools()
      void session.transport.refreshTools()
    } catch (error) {
      console.error('[tools] failed to refresh session tools:', error)
    }
  }
}
```
and call it from `setTools`. (Body given because the per-session `try/catch` and the fire-and-forget `void` are spec decisions, not implied by the signature.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test:web -- src/hooks/__tests__/useTools.mcp-update.test.ts`
Expected: all 3 PASS.

- [ ] **Step 5: Run the existing hooks tests to check nothing regressed**

Run: `yarn test:web -- src/hooks`
Expected: PASS (same pass count as before Task 3 plus 3).

- [ ] **Step 6: Commit**

```bash
git add web-app/src/hooks/useTools.ts web-app/src/hooks/__tests__/useTools.mcp-update.test.ts
git commit -m "fix(web-app): refresh every open thread's MCP tools on mcp-update

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `use-chat` effect invalidates before refreshing

**Files:**
- Modify: `web-app/src/hooks/use-chat.ts:110-117`
- Test: `web-app/src/hooks/__tests__/use-chat.tool-names.test.ts` (new)

**Interfaces:**
- Consumes: `CustomChatTransport.invalidateFrozenTools()` (Task 2), `useAppState.getState().updateMcpToolNames(names: string[])`.

- [ ] **Step 1: Write the failing test**

Mock `@/lib/custom-chat-transport` so `new CustomChatTransport()` returns a shared fake `{ invalidateFrozenTools: vi.fn(), refreshTools: vi.fn(), updateSystemMessage: vi.fn(), setOnTokenUsage: vi.fn(), updateRagToolsAvailability: vi.fn(), setContinueFromContent: vi.fn() }`. Mock any other module `use-chat.ts` imports that touches Tauri or the service hub, following the pattern in an existing hook test (for example `useAssistant.test.ts`). `useChat(options?)` takes an optional options object (`use-chat.ts:18-31`); render it as `useChat({ sessionId: 's1' })`.

```ts
it('invalidates the frozen tools before refreshing when MCP tool names change', async () => {
  renderHook(() => useChat(/* minimal args */))
  fake.invalidateFrozenTools.mockClear(); fake.refreshTools.mockClear()
  act(() => useAppState.getState().updateMcpToolNames(['fs::list']))
  expect(fake.invalidateFrozenTools).toHaveBeenCalledTimes(1)
  expect(fake.refreshTools).toHaveBeenCalledTimes(1)
  expect(fake.invalidateFrozenTools.mock.invocationCallOrder[0])
    .toBeLessThan(fake.refreshTools.mock.invocationCallOrder[0])
})
```

If `useChat` cannot be rendered in isolation without a large mock surface after 30 minutes of trying, replace this test with a narrower one: extract the effect body into an exported function `refreshTransportTools(transport: CustomChatTransport): void` in `use-chat.ts`, test that function directly, and have the effect call it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test:web -- src/hooks/__tests__/use-chat.tool-names.test.ts`
Expected: FAIL (`invalidateFrozenTools` called 0 times).

- [ ] **Step 3: Implement in `web-app/src/hooks/use-chat.ts:110-117`**

Inside the existing effect, call `transportRef.current.invalidateFrozenTools()` immediately before `transportRef.current.refreshTools()`. Update the comment to say the frozen routed set is dropped so the refresh re-routes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test:web -- src/hooks/__tests__/use-chat.tool-names.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole web-app suite and lint**

Run: `yarn test:web` then `yarn lint` at the repo root (it runs `eslint .` in `web-app`).
Expected: all tests PASS, lint clean.

- [ ] **Step 6: Commit**

```bash
git add web-app/src/hooks/use-chat.ts web-app/src/hooks/__tests__/use-chat.tool-names.test.ts
git commit -m "fix(web-app): drop frozen routed tools when MCP tool names change

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Done criteria

- All three source files changed as in the spec's "Files touched".
- `yarn test:web` green, new tests included.
- No change under `src-tauri/`.
- Manual check in the built app is optional (toolchain not installed); if later done: open a thread, send a message, enable or restart an MCP server in Settings, send again in the same thread, and the new tools must be available.
