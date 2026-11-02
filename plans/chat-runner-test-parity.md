# Route test adaptation parity matrix — current, not final verification

Latest route execution measured at `f4ea15326`: **110 passed / 110 tests**, including all **20 newly merged MCP identity cases**. Full suite at `f4ea15326` on merged parent `0b117ccd5`: **392 files / 5509 tests**, with TypeScript and production ESLint passing. (Historical record at `8c61e8940` after parent `cdecd19d4`: 106 route tests, 386 files / 5381 tests.) Command: `./node_modules/.bin/vitest run --project @janhq/web-app 'web-app/src/routes/threads/__tests__/$threadId.test.tsx'`.

This document maps coverage for one owned file, `web-app/src/routes/threads/__tests__/$threadId.test.tsx`; "no production edits" applies to this parity exercise only — the test file and this document. The PR's production changes are recorded in `plans/chat-runner-handoff.md`.

All pre-tool-suite tests and post-tool-suite presentation/attachment/versioning/context-resume/RAG availability tests retained. Async regenerate/edit/context transport fixtures adapted. Old tests assumed removed onFinish loop and SDK auto-send; replacements assert dispatch outcomes and actual SDK Chat + createChatRunStream, not a recreated serial loop.

Harness boundary: integration mounts actual Route, uses real SDK Chat/useSDKChat and actual runner adapter. `useChat` wrapper remains mocked; fake session transport mirrors cancellation and status wiring. Separate `hooks/__tests__/use-chat-runner.test.ts` exercises the production wrapper, not that mirror.

| Removed case | Replacement test substring | Assertion parity / limitation |
|---|---|---|
| runs the shell without a prompt while the switch is on | enforces the built-in shell switch | direct dispatch; shell execute once; approval none |
| does not run the shell, and says why, once the switch is off | enforces the built-in shell switch | disabled error + no shell execute |
| never prompts for a shell call while the switch is off | enforces the built-in shell switch | arrival+dispatch no prompt |
| serves an MCP tool named shell while the switch is off | serves an MCP tool named shell | MCP once/no built-in/one prompt |
| serves the call with the built-in, without a prompt, while web search is on | runs the built-in web tool | no prompt + execution once + budget |
| refuses the call, before any prompt, when web search is off and no server provides the tool | refuses disabled web tools | error wording/no execution/no prompt |
| requests approval as soon as a tool call arrives, before onFinish | requests approval on arrival | call id/name/thread/server verified |
| passes the tool server along with the approval request | requests approval on arrival | server name verified |
| does NOT execute the tool from onToolCall (execution deferred to onFinish) | requests approval on arrival | backend untouched and no injected result |
| executes approved tools in onFinish so the completed message can auto-resubmit | dispatches exactly one approved call | one returned outcome; onFinish never executes; real adapter serial case continues |
| reuses the early approval instead of prompting twice | dispatches exactly one approved call | duplicate arrival reuse; real integration prompt count equals calls |
| caps the tool result against the active model context window | hands MCP the context budget | known model window positive and bounded |
| omits the cap when the model reports no context window | hands MCP the context budget | unknown window cap omitted |
| hands a built-in web tool the budget of the active model context window | runs the built-in web tool | budget positive/bounded and exact input/name |
| executes every call in the turn | runs multiple calls serially | two calls outputs once, two model steps |
| runs them one at a time, not concurrently | runs multiple calls serially | first held pending; second starts after release |
| Stop cancels a running MCP call and frees the thread | %s cancels a running backend call | Stop variant: one cancel/no queued/no followup/busy false |
| a reply without tool calls leaves an earlier running call stoppable | Stop signal cancels / mounted Stop + navigation | no-tool newer finish does not steal a controller: removed controller implementation; see gap below |
| leaving the thread does not cancel a running MCP call | unmounting does not cancel a retained running dispatch | cancel untouched; returned result survives unmount |
| deleting the thread cancels its running MCP call | %s cancels a running backend call | delete variant: cancelChatRun then remove session; hook subscription not exercised |
| leaving a thread releases only its own settled runtime state | leaving a thread releases only its own settled runtime state | exact old runtime assertions restored |
| Stop in the thread in front does not end another thread\'s loop | navigation and Stop in another thread | A result/follow-up survives B Stop |
| a left thread\'s loop ending does not stop the current thread continuing | navigation and Stop in another thread | A continues; concurrent B run gap below |
| Stop reaches only its own thread\'s running call, also after returning | Stop after returning cancels only the retained thread | B Stop no cancel; A Stop after return once |
| Stop keeps a finished call\'s output and settles only the running one | Stop keeps a finished call's output | old persisted-content/metadata assertions retained verbatim |
| Stop after returning to the thread still settles the turn that owns the call | Stop after returning cancels only the retained thread | return Stop preserved first output/settled second; newer unrelated turn gap below |
| Stop settles the turn whose loop it aborts, not just the last message | Stop persists tool state | older loop ownership removed; newer unrelated turn gap below |
| Stop saves from the live chat state, not the throttled snapshot | Stop saves from the live chat state | old stale/live rewrite assertions retained verbatim |
| drains the runtime queue and times every call | runs multiple calls serially | queue empty + each startedAt/endedAt defined |
| records a cut-short approval as the chat closing, not a user denial | deletion with adapter abort | callback interrupted error, no execution/late decision; normalized stopped in real adapter |
| leaving the thread lets the turn continue after its tool call | navigation and Stop in another thread | real SDK canonical result + second model step |
| leaving the thread keeps its pending approval answerable | a pending approval survives navigation | return answers once/backend once/follow-up once |
| another thread ending does not drop the approval in flight here | a pending approval survives navigation | B terminal abort does not clear A approval; no duplicate prompt |
| settles the calls queued behind one whose approval was cut short | Stop during approval never executes | both queued cards output-error/no backend/no follow-up/late ignored |
| keeps going when one call is denied | a denied first call still executes the next | first output-error, second output available, continuation once |
| leaves nothing queued after a denied call | denies one call without blocking | no duration for denial/endedAt defined/queue empty |
| marks the thread busy during onFinish execution and clears it when tools drain | runs multiple calls serially | SDK status-driven busy true while held / false after terminal |
| parameterized MCP web_search/web_fetch collision | uses MCP for %s when built-in web is disabled | both names, one prompt/one MCP/no built-in |
| parameterized edit/regenerate cancellation | %s settles the original SDK operation then starts exactly one replacement during a held tool | edit/regenerate/Continue variants: original SDK operation settles before exactly one guarded replacement request; held tool cancelled, no queued calls |

## Ownership boundaries and follow-up verification
- Closed after initial matrix: mounted route concurrent A+B regression now verifies independent completion/continuation.
- Closed with an explicit replacement contract: production wrapper synchronously reserves admission and rejects overlapping send/regenerate BEFORE SDK message/activeResponse mutation. The real-hook regression checks unchanged original messages/status, Stop cancels that original owner, no extra request, and a subsequent accepted turn succeeds. Route edit/regenerate awaits cancellation before replacement; there cannot be an older orphan run behind a newer unrelated completed reply.
- Closed separately: `hooks/__tests__/use-chat-runner.test.ts` uses the production wrapper with real SDK Chat/runTurn, verifying deletion alone aborts a hung dispatch and releases the snapshot.
- Closed separately: production-wrapper test verifies session-store `isStreaming` during held dispatch, ready after drain, exactly one follow-up and typed output.
- Adapter/model tests now cover fail-closed parser/SDK approvals/duplicate ids, cancellation, same-wave queued settling, image sentinels, typed results, canonical serializer reload and negative controls, regenerated model snapshot and stale discovery. Retry/manual streaming gates remain independently verified; no claim from counts alone.

After MCP integration, all 20 newly merged identity cases remain covered; actual guarded SDK replacement tests strengthen edit/regenerate and add Continue receipt/persistence checks. Continue during a held tool is defensive handler coverage, not a normal button-visibility claim.

Matrix maps all 36 literal old cases + both parameterized groups (38 definitions). Multiple assertions consolidated where contract moved; renamed old implementation-only onFinish/auto-resubmit assertions are explicitly replaced by dispatch + real adapter canonical-output/follow-up assertions.
