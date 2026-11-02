# #505 preparatory home scope → runtime handoff

Base: 9207feb31 / integration PR #9529. **Not a unified-flow milestone or execution parity claim.**

## Actual production slice
- One existing ChatInput instance, model picker, attachment draft, project/assistant handling and Send implementation. No extra execution loop.
- Reusable `UnifiedHomeScope` is used in the established home task workflow. It distinguishes prompt attachments from filesystem scope and explicitly discloses read/write access and unchanged network/memory settings. Removing a folder retains project intent.
- Shared route-local `useHomeScope` preserves project/folder intent during workflow selection without carrying accepted scope into the next home draft.
- Home attachments use one canonical bucket across existing workflow selection. No migration is required: the attachment store is in-memory; no old key is read or written.
- Existing Chat/Cowork choice and legacy session renderer/permission context remain. Chat remains default and unchanged for unsupported models. No new grants or automatic model/provider switching.
- **No shipped preview setting or selectable-but-unsendable scope.** An earlier opt-in/false-return guard was rejected during local design review and removed before commit. Existing task submission remains functional. This deliberately defers selector removal until the next runtime slice rather than relabeling modes.

## Next runtime slice — coordinate before editing
Owned elsewhere: production transcript serializer, route/transport continuity, shared capability policy and MCP fixes. No edits to those files in this slice.

1. Runtime owner supplies an execution-neutral submission boundary accepting existing text/files/documents, model/project identity and requested folder scope; no mode inference call. Scope selection is never blanket authorization.
2. Shared policy evaluates availability and explicit writable-folder consent. Unsupported models retain direct Chat and actionable explanations; no automatic model/provider fallback. Network, shell, MCP and durable-memory activation must remain separate and explicit.
3. Serializer carries Chat turns, attachments, tools/results and permission provenance losslessly into tool work and back, including restart, cancellation and retries.
4. Wire the same existing ChatInput to that boundary. Direct Chat stays a one-model-call path. Effective scope belongs to the resulting conversation, not the next draft. Preserve refused-submit prompt/attachments, and existing attachment transfer on accepted direct sends.
5. Use the established task renderer contextually for work/progress/files/changes; no empty agent dashboard for ordinary answers. Keep old Cowork sessions readable/runnable with their stored context.
6. Only then replace the required home selector with one composer/scope flow. If rollout is needed, use existing General settings persistence with an accessible temporary setting and explicit removal gate. Do not add a flag in advance of functional runtime or retain duplicate composer branches permanently. Harmonize project landing entry in that rollout.

## Gates before default-on
Prove direct→tools→direct history continuity, approvals, temporary-chat/durable-memory isolation, unsupported models, project instructions/settings, media/document attachments, stop/retry and resume. Require native light/dark/narrow/accessibility QA (separate isolation worker), independent code review and measured direct-answer performance. Browser fixture evidence is synthetic UI-only, not native or provider/runtime parity evidence.
