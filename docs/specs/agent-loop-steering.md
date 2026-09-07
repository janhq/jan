# Active-loop steering for Jan Agent CLI TUI

Status: proposed; runtime implementation is not included in this specification.

Tracking issue: https://github.com/janhq/jan/issues/8863

## Problem

Messages submitted while Jan Agent CLI TUI is working currently wait until the entire agent turn finishes. A correction such as "use pnpm instead" should be able to jump into the active loop before the next model step, rather than wait until the agent has completed work based on outdated instructions.

This follows up on #8485 (message queuing for agent turns). That request made input non-blocking with turn-end dequeueing; this request changes when the active agent consumes a user's follow-up.

## Goal

Let users steer the running Jan agent, similar to the requested Claude Code interaction: submit a message while the agent is working and have it considered at the next safe boundary within the same run.

Scope: Jan Agent CLI TUI and the shared loop plumbing needed to support it. No change to desktop/web queue behavior in this request.

## Requested UX

1. Keep the composer editable while the agent is running.
2. Enter submits a steering message to the active run, rather than waiting for the whole turn to finish.
3. Show that the message is pending until the loop acknowledges consumption, then display it once in the transcript.
4. Consume steering before the next model request, after any in-flight tool-call batch has recorded all its results. Do not forcibly abort tools or leave unmatched tool calls.
5. Preserve submission order when multiple messages arrive. A message submitted as a run finishes must not disappear or be processed twice; fall back to a new turn when it can no longer join the active run.
6. Preserve image attachments and resolved @path context for each submitted message.
7. Keep cancellation discoverable for messages not yet consumed; make clear that removing a pending message does not undo tool execution.

## Technical Considerations

- `App::submit_user_text` in `src-tauri/src/core/cli/tui.rs` currently stores running-time input in `message_queue`; `dequeue_next` submits it after a turn ends.
- Add a session/run-scoped input channel and consumption acknowledgement between the TUI and `src-tauri/src/core/agent/loop.rs`.
- Keep canonical model history, visible transcript, and persisted session history consistent, with exactly-once message delivery.
- Do not inject user text between an assistant tool-call message and its corresponding tool results.
- Handle completion/error/cancel races and session switch/reset without dropping input or leaking it to another session or a child agent.
- Preserve dedicated permission/question input routing; steering must not implicitly approve a tool or answer an outstanding question.
- Keep callers without a steering channel behaving as before.

## Acceptance Criteria

- [ ] During a multi-step tool run, a follow-up is included in the next eligible model request before the original turn finishes.
- [ ] Multiple follow-ups are consumed once, in submission order.
- [ ] In-flight tool results remain correctly paired and tool execution is not forcibly interrupted.
- [ ] Pending/consumed state is visible; consumed messages appear once in transcript and persisted history.
- [ ] Attachments and @path expansions remain associated with the correct message.
- [ ] Completion, error, cancellation, and session-switch races neither lose nor duplicate messages.
- [ ] Permission/question prompts and non-TUI callers do not regress.
- [ ] Tests cover safe-boundary injection, ordering, acknowledgement, lifecycle races, and history consistency.

## Branches

- Base branch for the implementation PR: `dev`.
- This supersedes only the turn-end delivery behavior requested in #8485, not its non-blocking-input goal.

/cc @thinhlpg
