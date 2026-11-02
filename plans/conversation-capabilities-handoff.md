# Scoped Chat consent — integration contract (not rollout)

Base: `db714205c`. This slice is **not ready for a PR or activation** until the actual Chat adapter consumes it with per-call enforcement. No consent controls are mounted yet. No Cowork migration, MCP trust, route serializer or runner changes here.

## Public API

`web-app/src/lib/conversationCapabilities.ts`:
- `ConversationCapabilitiesV1`: `{ version: 1, folderScope: { path, access: 'read' | 'write' } | null, shellNetwork: boolean, memoryWrite: boolean }`.
- `defaultConversationCapabilities()` returns fresh denied scoped defaults. It does not disable existing Chat tools or MCP trust.
- `resolveConversationCapabilities(unknown)` strictly accepts the exact versioned shape; unknown versions/keys, invalid paths or permissions deny the entire scoped value.
- `conversationCapabilityDecision(value, { capability, path? })` evaluates `folderRead`, `folderWrite`, `shellNetwork`, `memoryWrite`. Folder requests refer to the exact selected grant root, **not an arbitrary model path**. This is necessary consent, not sufficient execution authority.

`ConversationCapabilitiesConsent` is controlled pending draft UI: `value`, `onChange`, asynchronous `onPickFolder`, optional `disabled`. Explicit folder selection starts read-only. Completed reselect resets write permission; cancelling the native dialog leaves prior explicit selection unchanged. Remove clears folder consent. Network and durable memory writes are independent opt-ins. Project selection grants no filesystem access. Picker results are invalidated on draft/disabled changes and unmount.

`useThreads.getState().setConversationCapabilities(threadId, unknown): Promise<void>` validates and calls the dedicated service patch. Rejects missing and legacy Cowork threads. Immediately denies scoped capabilities in memory while saving; requests serialize, and superseded completions cannot restore access. Success merges only the grant into the latest in-memory thread metadata. A failed save throws and leaves a process-local authoritative overlay, including on background reload. Successful changes also retain their process-local authority so older fetched snapshots cannot restore revoked consent. Dispatch MUST call `useThreads.getState().getConversationCapabilities(threadId)` each time; this overlay-aware getter returns denied defaults for missing, temporary or Cowork threads. Do not bypass it with disk/service fetches.

`ChatInput.prepareThreadCreation?: () => ((threadId: string) => Promise<boolean>)` snapshots pending consent synchronously before async reference expansion/project loading. Applies only after a persistent thread has been created, before initial-message storage, agent transfer or navigation. False/throw preserves draft and attachments and does not start the turn. Temporary Chat refuses this preparation; custom `onSubmit` owns its own lifecycle.

## Persistence boundary

Native `set_thread_conversation_capabilities(threadId, value)` validates the narrow v1 shape and patches only `metadata.conversationCapabilities` on an existing matching desktop thread under the same thread lock as modify/delete/assistant writers. Ordinary whole-record `modify_thread` preserves stored capabilities, including absence, so stale snapshots are not consent authority. Patch must not create missing directories or threads. Mobile patch is explicitly unsupported and rejects. Temporary and legacy Cowork records are rejected by the service/store/native boundary. Service errors propagate, with no optional-extension success fallback.

Lexical path validation is **not** filesystem identity, canonicalization, symlink or containment verification. Backend actual dispatch must enforce canonical roots, current permissions and sandbox availability. Folder roots from another host are not local authority.

## Required adapter integration before activation

1. Mount consent only where the selected model/runtime actually enforces all exposed capabilities; unsupported models remain direct Chat. Do not silently promote to Cowork or inherit its defaults.
2. Capture the pending draft snapshot with `prepareThreadCreation`; await the setter after creation and before delivery. On failure show a blocking warning and retain draft/attachments. Do not claim permission changes were saved.
3. Re-read current in-memory thread metadata and revalidate on **every** dispatch, before auto-allow; do not capture grants with frozen tool schemas. Frozen advertisement, MCP trust and backend containment remain separate gates.
4. Display accepted active scope, not just pending draft. Do not mount unsupported/unenforced permission controls.
5. A failed disk save can leave older consent on disk. The in-memory deny overlay is not durable across process restart. Establish re-confirmation/restart policy before claiming failed revocation survives restart. Do not silently replay stale persisted authority.
6. Independent final code review and separate isolated UI/runtime verification remain required after actual integration. Synthetic component-only light/dark/narrow/keyboard verification is not native picker, persistence, provider or dispatch QA.
