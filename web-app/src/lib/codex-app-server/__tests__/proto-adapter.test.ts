import { describe, expect, it } from 'vitest'
import { CodexProtoEventMapper } from '../proto-adapter'

describe('CodexProtoEventMapper', () => {
  it('maps proto session and turn events into app-server events', () => {
    const mapper = new CodexProtoEventMapper({ appThreadId: 'jan-thread-1' })

    expect(
      mapper.map({
        id: '0',
        msg: {
          type: 'session_configured',
          session_id: 'codex-session-1',
          model: 'gpt-5',
        },
      })
    ).toEqual({
      type: 'thread_started',
      appThreadId: 'jan-thread-1',
      threadId: 'codex-session-1',
      thread: {
        type: 'session_configured',
        session_id: 'codex-session-1',
        model: 'gpt-5',
      },
    })

    expect(
      mapper.map({
        id: 'turn-1',
        msg: { type: 'task_started' },
      })
    ).toEqual({
      type: 'turn_started',
      threadId: 'codex-session-1',
      turnId: 'turn-1',
      turn: { type: 'task_started' },
    })

    expect(
      mapper.map({
        id: 'turn-1',
        msg: { type: 'task_complete' },
      })
    ).toEqual({
      type: 'turn_completed',
      threadId: 'codex-session-1',
      turnId: 'turn-1',
      turn: { type: 'task_complete' },
    })
  })

  it('maps assistant, reasoning, plan, and command deltas', () => {
    const mapper = new CodexProtoEventMapper({ appThreadId: 'jan-thread-1' })
    mapper.map({
      id: '0',
      msg: { type: 'session_configured', session_id: 'codex-session-1' },
    })
    mapper.map({ id: 'turn-1', msg: { type: 'task_started' } })

    expect(
      mapper.map({
        id: 'assistant-event',
        msg: {
          type: 'agent_message_content_delta',
          item_id: 'assistant-1',
          delta: 'hello',
        },
      })
    ).toEqual({
      type: 'assistant_delta',
      threadId: 'codex-session-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      delta: 'hello',
    })

    expect(
      mapper.map({
        id: 'reasoning-event',
        msg: {
          type: 'reasoning_content_delta',
          item_id: 'reasoning-1',
          summary_index: 2,
          delta: 'thinking',
        },
      })
    ).toEqual({
      type: 'reasoning_delta',
      threadId: 'codex-session-1',
      turnId: 'turn-1',
      itemId: 'reasoning-1',
      delta: 'thinking',
      summaryIndex: 2,
      contentIndex: undefined,
    })

    expect(
      mapper.map({
        id: 'plan-event',
        msg: { type: 'plan_delta', item_id: 'plan-1', delta: '1. inspect' },
      })
    ).toEqual({
      type: 'plan_delta',
      threadId: 'codex-session-1',
      turnId: 'turn-1',
      itemId: 'plan-1',
      delta: '1. inspect',
    })

    expect(
      mapper.map({
        id: 'command-event',
        msg: {
          type: 'exec_command_output_delta',
          call_id: 'cmd-1',
          chunk: Buffer.from('stdout\n').toString('base64'),
        },
      })
    ).toEqual({
      type: 'command_output_delta',
      threadId: 'codex-session-1',
      turnId: 'turn-1',
      itemId: 'cmd-1',
      delta: 'stdout\n',
    })
  })

  it('maps proto approval and host requests to existing request events', () => {
    const mapper = new CodexProtoEventMapper({ appThreadId: 'jan-thread-1' })
    mapper.map({
      id: '0',
      msg: { type: 'session_configured', session_id: 'codex-session-1' },
    })
    mapper.map({ id: 'turn-1', msg: { type: 'task_started' } })

    expect(
      mapper.map({
        id: 'approval-event',
        msg: {
          type: 'exec_approval_request',
          call_id: 'approval-1',
          command: ['npm', 'test'],
        },
      })
    ).toEqual({
      type: 'approval_request',
      request: {
        id: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        params: expect.objectContaining({
          command: ['npm', 'test'],
          threadId: 'codex-session-1',
          turnId: 'turn-1',
        }),
      },
    })

    expect(
      mapper.map({
        id: 'permissions-event',
        msg: {
          type: 'request_permissions',
          request_id: 'permissions-1',
          permissions: [{ kind: 'write' }],
        },
      })
    ).toEqual({
      type: 'server_request',
      request: {
        id: 'permissions-1',
        method: 'item/permissions/requestApproval',
        params: expect.objectContaining({
          permissions: [{ kind: 'write' }],
          threadId: 'codex-session-1',
          turnId: 'turn-1',
        }),
      },
    })
  })
})
