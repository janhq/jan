# Unified conversation flow — consolidation plan

Status: proposal, not an implementation commitment. This is a follow-up to the shared history/storage work in `merge-chat-cowork-data-model.md`, not a claim that the execution paths are already unified.

## Product goal

One composer and conversation. Users describe an outcome, not an execution mode. Answer directly by default; use tools when needed. Workspace access, network access, and approvals remain explicit. Removing Chat/Cowork selection must not expand permissions.

## Scope and sequence

### 1. Establish the capability contract
- Inventory model-visible tools separately from attachments, composer settings, and result UI.
- Define capability availability from model support, provider, platform, workspace, permissions, and user configuration—not a Chat/Cowork mode.
- Define defaults for web/network, filesystem scope, shell, MCP, skills, and persistent memory.
- Keep unsupported capabilities visibly unavailable with actionable explanations.

### 2. Introduce a shared execution boundary
- Define a common request/event contract: text, attachments, context, tool calls/results, approvals, reasoning, usage, cancellation, and errors.
- Initially adapt existing Chat and Cowork implementations; do not require an immediate rewrite of both.
- Choose execution by explicit capabilities and policy, without a mandatory extra LLM classification call.
- Preserve a one-model-call direct-answer path; agent execution must not imply mandatory planning.
- Specify how a chat-like conversation gains tool access in place, and how its existing history is passed without duplication or lossy conversion.

### 3. Unify tool access and safety
- Establish a capability registry with stable tool identities, schemas, availability, permission requirements, and UI metadata.
- Reconcile overlapping implementations before exposing both versions of the same capability.
- Make tool discovery/activation compact; measure any added discovery round trip against schema-token savings.
- Scope filesystem reads/writes, shell, network, and MCP permissions consistently; external tool output is untrusted context, not authority.
- Bound steps, retries, tool output, and context growth. Support reliable Stop and approval cancellation.
- Specify memory independently of tool execution: temporary chats must not silently acquire durable memory; project instructions and skills must not imply access outside the selected scope.

### 4. Make conversation state execution-neutral
- Retain existing transcripts losslessly; a shared sidebar and Thread id alone do not unify message formats.
- Define stable representations/adapters for tool calls, tool results, attachments, reasoning, approvals, and resumable runs.
- Support direct answer → tool work → direct answer in one conversation, including after restart.
- Preserve routing, search, titles, projects, model settings, export, deletion, sandbox cleanup, and old-thread compatibility.
- Retire mode metadata and old stores only after compatibility and rollback requirements are met.

### 5. Simplify the interface
- Remove the Chat/Cowork selector only when capability parity and safety are demonstrated.
- One model picker, attachment entry point, workspace control, capability/settings menu, and Send/Stop behavior.
- Show plan/progress/files/changes/preview panels only when relevant; do not impose an agent dashboard on ordinary answers.
- Ask for a workspace just in time. Clearly show active scope and permission changes.
- Retain an accessible way to disable tools if desired; this is a capability preference, not another required mode choice.

### 6. Validate performance and roll out gradually
- Benchmark the current Chat path against unified direct-answer and representative tool tasks on target local models/hardware.
- Measure prompt/schema tokens, time to first token, total latency, peak memory/KV use, tool-call reliability, and completion rate.
- Cover tool-capable and non-tool-capable models, local and remote providers, offline operation, and narrow-context models.
- Test cross-turn capability changes, permissions, restart/resume, attachments, MCP failures, stop/retry, long tool output, projects, migrations, and native desktop behavior.
- Feature-flag rollout; retain old execution adapters until parity and rollback tests pass.

## Suggested delivery slices

1. **Inventory and policy only:** agreed capability matrix and default permissions; no behavior change.
2. **Shared capability layer behind a flag:** existing screens keep working; shared tool availability and permission handling have tests.
3. **One-flow prototype:** direct answers and a small, bounded tool set in one conversation; prove history continuity before adding every tool.
4. **Parity and migration:** bring across remaining capabilities, settings, result panels, and resume behavior; test legacy conversations.
5. **Default-on:** remove the selector after model/performance/native QA gates pass; clean up legacy paths in a later release.

Each slice should be independently reviewable. Do not combine storage migration, all tool implementations, and selector removal into one large change.

## Release gates
- Ordinary questions require no mandatory planning or routing inference call.
- No silently expanded filesystem, shell, network, or MCP access.
- No lost/duplicated turns when tool use begins or a conversation resumes.
- Unsupported models retain working direct chat.
- Existing conversations remain readable and deletable.
- Performance budgets are agreed from measured baselines, not guessed percentages.

## Decisions before implementation
1. Default capability policy: which read-only tools are initially available, and which require activation?
2. Workspace policy: managed scratch workspace by default, with user-selected folders as additional scope?
3. Model fallback: explain unavailable tools, or offer an explicit model switch (never silently upload local conversation context)?
4. Persistence strategy: shared event format now, or lossless adapters first?
5. Release scope: desktop first; specify supported local/remote providers and platform parity.

## Current capability inventory

Source audit (2026-11-02; static code inspection, not live execution):

| Capability | Chat | Cowork |
|---|---|---|
| Shell | Native `shell`; sandboxed, network-closed | Native `shell`; network on by default, configurable |
| Web | `web_search`, `web_fetch` | `web_search`, `web_fetch` |
| Dedicated filesystem tools | Not in audited native tool list; shell is a separate route | `read`, `ls`, `find`, `grep`, `write`, `edit` |
| Document retrieval | Conditional `list_attachments`, `retrieve`, `get_chunks` | No RAG advertisement in current builder; separate attachment processing |
| MCP | Dynamic tools | No MCP advertisement in current builder |
| Screenshot | Not in audited native tool list | `screenshot` |
| Memory tools | Not in audited native tool list | `memory_list`, `memory_read`, `memory_write` |
| Skill tools | Not in audited native tool list | `skill_list`, `skill_read`, `skill_write` |
| Task orchestration | Not in audited native tool list | `todo`, `ask`, `task`, `monitor` |

Cowork attached folders are writable in place; stale read-only comments must not be treated as permission enforcement. Shell network differences are an explicit policy decision before unification, not an implementation detail to inherit accidentally.

Primary implementation anchors: `web-app/src/lib/agentTools.ts`, `custom-chat-transport.ts`, `coworkTools.ts`, `coworkTransport.ts`, `coworkDispatch.ts`, `coworkAttachments.ts`; `web-app/src/routes/threads/$threadId.tsx`; `extensions/rag-extension/src/tools.ts`.

Both flows share composer/model transport foundations, but tool discovery, dispatch, permissions, prompts, and transcript/runtime state remain separate. Presence in a UI or schema does not prove successful runtime execution on every model/platform. Installed MCP inventory, machine sandbox availability, credentials, and effective user settings were not inspected. Hidden/legacy Chat agent-mode behavior was not fully traced and should not be equated with Cowork.
