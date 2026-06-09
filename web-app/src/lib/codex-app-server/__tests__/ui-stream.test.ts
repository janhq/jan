import { describe, expect, it, vi } from 'vitest'
import { codexEventsToUIMessageStream } from '../ui-stream'
import type { CodexAppServerEvent } from '../types'

async function collect(stream: ReadableStream) {
  const reader = stream.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

async function* events(values: CodexAppServerEvent[]) {
  for (const value of values) {
    yield value
  }
}

describe('codexEventsToUIMessageStream', () => {
  it('maps assistant deltas into AI SDK text chunks and finishes the message', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'turn_started',
            threadId: 'thread-1',
            turnId: 'turn-1',
            turn: {},
          },
          {
            type: 'assistant_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'assistant-1',
            delta: 'hello',
          },
          {
            type: 'assistant_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'assistant-1',
            delta: ' world',
          },
          {
            type: 'turn_completed',
            threadId: 'thread-1',
            turnId: 'turn-1',
            turn: { status: 'completed' },
          },
        ]),
        { messageId: 'message-1' }
      )
    )

    expect(chunks).toEqual([
      { type: 'start', messageId: 'message-1' },
      {
        type: 'data-codex-event',
        id: 'evt-turn_started-turn-1',
        data: expect.objectContaining({ type: 'turn_started' }),
      },
      { type: 'text-start', id: 'assistant-1' },
      { type: 'text-delta', id: 'assistant-1', delta: 'hello' },
      { type: 'text-delta', id: 'assistant-1', delta: ' world' },
      {
        type: 'data-codex-event',
        id: 'evt-turn_completed-turn-1',
        data: expect.objectContaining({ type: 'turn_completed' }),
      },
      { type: 'text-end', id: 'assistant-1' },
      {
        type: 'finish',
        finishReason: 'stop',
        messageMetadata: expect.objectContaining({
          codex: expect.objectContaining({ threadId: 'thread-1', turnId: 'turn-1' }),
        }),
      },
    ])
  })

  it('emits non-text Codex events as data chunks', async () => {
    const approval = {
      type: 'approval_request',
      request: { id: 'approval-1', method: 'item/commandExecution/requestApproval' },
    } satisfies CodexAppServerEvent

    const chunks = await collect(codexEventsToUIMessageStream(events([approval])))

    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'data-codex-event', data: approval },
      { type: 'finish', finishReason: 'stop', messageMetadata: expect.any(Object) },
    ])
  })

  it('propagates Codex stream errors as UI error chunks', async () => {
    const error = new Error('provider misconfigured')
    const chunks = await collect(
      codexEventsToUIMessageStream(events([{ type: 'error', error }]))
    )

    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'error', errorText: 'provider misconfigured' },
      { type: 'finish', finishReason: 'error', messageMetadata: expect.any(Object) },
    ])
  })

  it('interrupts the Codex turn when the UI stream is cancelled', async () => {
    const interrupt = vi.fn()
    const stream = codexEventsToUIMessageStream(
      events([
        {
          type: 'assistant_delta',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'hello',
        },
      ]),
      { interrupt }
    )

    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(interrupt).toHaveBeenCalled()
  })

  it('maps reasoning_delta to native AI SDK reasoning chunks and aggregates command_output_delta', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'reasoning_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            delta: 'Thinking',
          },
          {
            type: 'reasoning_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            delta: ' hard',
          },
          {
            type: 'command_output_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'cmd-1',
            delta: 'Running',
          },
          {
            type: 'command_output_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'cmd-1',
            delta: ' tests',
          },
          {
            type: 'item_completed',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            item: {},
          },
        ])
      )
    )

    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'reasoning-start', id: 'reasoning-1' },
      { type: 'reasoning-delta', id: 'reasoning-1', delta: 'Thinking' },
      { type: 'reasoning-delta', id: 'reasoning-1', delta: ' hard' },
      {
        type: 'data-codex-event',
        id: 'cmd-cmd-1',
        data: {
          type: 'command_output',
          itemId: 'cmd-1',
          output: 'Running',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      },
      {
        type: 'data-codex-event',
        id: 'cmd-cmd-1',
        data: {
          type: 'command_output',
          itemId: 'cmd-1',
          output: 'Running tests',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      },
      { type: 'reasoning-end', id: 'reasoning-1' },
      {
        type: 'data-codex-event',
        id: 'evt-item_completed-reasoning-1',
        data: expect.objectContaining({ type: 'item_completed' }),
      },
      { type: 'finish', finishReason: 'stop', messageMetadata: expect.any(Object) },
    ])
  })

  it('streams separate reasoning parts for summary/content indices', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'reasoning_part_added',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            summaryIndex: 0,
          },
          {
            type: 'reasoning_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            summaryIndex: 0,
            delta: 'Summary',
          },
          {
            type: 'reasoning_part_added',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            summaryIndex: 1,
          },
          {
            type: 'reasoning_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            summaryIndex: 1,
            delta: 'More summary',
          },
          {
            type: 'reasoning_part_added',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            contentIndex: 0,
          },
          {
            type: 'reasoning_delta',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            contentIndex: 0,
            delta: 'Details',
          },
          {
            type: 'item_completed',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'reasoning-1',
            item: {},
          },
        ])
      )
    )

    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'reasoning-start', id: 'reasoning-1:summary:0' },
      { type: 'reasoning-delta', id: 'reasoning-1:summary:0', delta: 'Summary' },
      { type: 'reasoning-start', id: 'reasoning-1:summary:1' },
      { type: 'reasoning-delta', id: 'reasoning-1:summary:1', delta: 'More summary' },
      { type: 'reasoning-start', id: 'reasoning-1:content:0' },
      { type: 'reasoning-delta', id: 'reasoning-1:content:0', delta: 'Details' },
      { type: 'reasoning-end', id: 'reasoning-1:summary:0' },
      { type: 'reasoning-end', id: 'reasoning-1:summary:1' },
      { type: 'reasoning-end', id: 'reasoning-1:content:0' },
      {
        type: 'data-codex-event',
        id: 'evt-item_completed-reasoning-1',
        data: expect.objectContaining({ type: 'item_completed' }),
      },
      { type: 'finish', finishReason: 'stop', messageMetadata: expect.any(Object) },
    ])
  })
})

describe('codexEventsToUIMessageStream app-server parity visibility', () => {
  it('renders plan, diff, model, moderation, and auto-approval updates as visible codex activity chunks', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'turn_plan_updated',
            threadId: 'thread-1',
            turnId: 'turn-1',
            plan: [{ step: 'inspect', status: 'in_progress' }],
            params: {},
          },
          {
            type: 'turn_diff_updated',
            threadId: 'thread-1',
            turnId: 'turn-1',
            diff: { files: ['src/app.ts'] },
            params: {},
          },
          {
            type: 'model_rerouted',
            threadId: 'thread-1',
            turnId: 'turn-1',
            fromModel: 'gpt-5-mini',
            toModel: 'gpt-5',
            reason: 'verification',
            params: {},
          },
          {
            type: 'model_verification',
            threadId: 'thread-1',
            turnId: 'turn-1',
            status: 'verified',
            params: {},
          },
          {
            type: 'turn_moderation_metadata',
            threadId: 'thread-1',
            turnId: 'turn-1',
            metadata: { flagged: false },
            params: {},
          },
          {
            type: 'auto_approval_review_event',
            method: 'item/autoApprovalReview/completed',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'item-1',
            params: {},
          },
        ])
      )
    )

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'data-codex-event',
          id: 'plan-update-turn-1',
          data: expect.objectContaining({ type: 'plan', threadId: 'thread-1' }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          id: 'diff-update-turn-1',
          data: expect.objectContaining({ type: 'file_change_patch', threadId: 'thread-1' }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Model rerouted'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Model verification'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Moderation metadata'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Auto-approval review event'),
          }),
        }),
      ])
    )
  })
})

describe('codexEventsToUIMessageStream runtime status visibility', () => {
  it('renders account, MCP, remote, filesystem, and process status events as visible activity chunks', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'account_login_completed',
            loginId: 'login-1',
            success: true,
            params: {},
          },
          {
            type: 'account_updated',
            authMode: 'chatgpt',
            planType: 'plus',
            params: {},
          },
          {
            type: 'account_rate_limits_updated',
            rateLimits: { primary: 'ok' },
            params: {},
          },
          {
            type: 'mcp_oauth_login_completed',
            name: 'github',
            success: true,
            params: {},
          },
          {
            type: 'mcp_startup_status_updated',
            threadId: 'thread-1',
            name: 'filesystem',
            status: 'ready',
            params: {},
          },
          {
            type: 'remote_control_status_changed',
            status: 'enabled',
            serverName: 'codex-remote',
            params: {},
          },
          {
            type: 'fs_changed',
            watchId: 'watch-1',
            changedPaths: ['/repo/a.ts'],
          },
          {
            type: 'process_exited',
            processHandle: 'proc-1',
            exitCode: 0,
            stdout: '',
            stderr: '',
          },
        ])
      )
    )

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Codex account login completed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Codex account updated'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('rate limits updated'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('MCP OAuth login completed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('MCP server filesystem status'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Remote control status'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Filesystem watch watch-1 changed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Process proc-1 exited'),
          }),
        }),
      ])
    )
  })
})

describe('codexEventsToUIMessageStream thread lifecycle visibility', () => {
  it('renders thread lifecycle updates as visible activity chunks', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'thread_settings_updated',
            threadId: 'thread-1',
            settings: { approvalPolicy: 'never' },
          },
          { type: 'thread_archived', threadId: 'thread-1' },
          { type: 'thread_unarchived', threadId: 'thread-1' },
          { type: 'thread_name_updated', threadId: 'thread-1', name: 'Work' },
          { type: 'thread_closed', threadId: 'thread-1' },
          {
            type: 'thread_goal_updated',
            threadId: 'thread-1',
            goal: { objective: 'ship clone' },
          },
          { type: 'thread_goal_cleared', threadId: 'thread-1' },
        ])
      )
    )

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('settings updated'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('archived'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('unarchived'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('renamed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('closed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('goal updated'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('goal cleared'),
          }),
        }),
      ])
    )
  })
})

describe('codexEventsToUIMessageStream capability change visibility', () => {
  it('renders skills, plugins, and hooks changes as visible activity chunks', async () => {
    const chunks = await collect(
      codexEventsToUIMessageStream(
        events([
          {
            type: 'skills_changed',
            threadId: 'thread-1',
            skills: { available: ['skill-a'] },
          },
          {
            type: 'plugins_changed',
            threadId: 'thread-1',
            plugins: { installed: ['plugin-a'] },
          },
          {
            type: 'hooks_changed',
            threadId: 'thread-1',
            hooks: { count: 1 },
          },
        ])
      )
    )

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Codex skills changed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Codex plugins changed'),
          }),
        }),
        expect.objectContaining({
          type: 'data-codex-event',
          data: expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('Codex hooks changed'),
          }),
        }),
      ])
    )
  })
})
