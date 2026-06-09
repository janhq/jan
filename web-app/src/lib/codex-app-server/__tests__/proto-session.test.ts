import { describe, expect, it } from 'vitest'
import { startCodexSession } from '../api'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from '../types'
import type { CodexProcessSpawner } from '../process-manager'

class ScriptedProtoProcess implements CodexProcess {
  writes: unknown[] = []
  spawnArgs: string[] = []
  rejectUserInputSubmission = false

  private stdoutListeners = new Set<(line: string) => void>()
  private stderrListeners = new Set<(line: string) => void>()
  private exitListeners = new Set<(exit: CodexProcessExit) => void>()

  start() {
    this.emit({
      id: '0',
      msg: { type: 'session_configured', session_id: 'codex-session-1' },
    })
  }

  writeLine(line: string) {
    const message = JSON.parse(line)
    this.writes.push(message)

    if (message.op?.type === 'user_input') {
      if (this.rejectUserInputSubmission) {
        this.emitStderr(
          'ERROR codex_cli::proto: invalid submission: unknown variant `user_turn`'
        )
        return
      }
      this.emit({ id: message.id, msg: { type: 'task_started' } })
      this.emit({
        id: message.id,
        msg: {
          type: 'agent_message_content_delta',
          item_id: 'assistant-1',
          delta: 'hello',
        },
      })
      this.emit({
        id: message.id,
        msg: {
          type: 'exec_approval_request',
          call_id: 'approval-1',
          command: ['pwd'],
        },
      })
      this.emit({
        id: message.id,
        msg: {
          type: 'apply_patch_approval_request',
          call_id: 'patch-approval-1',
          changes: { '/repo/file.txt': { add: true } },
        },
      })
      this.emit({
        id: message.id,
        msg: {
          type: 'request_user_input',
          call_id: 'user-input-1',
          questions: [
            {
              id: 'target_file',
              header: 'Target',
              question: 'Which file?',
            },
          ],
        },
      })
      this.emit({
        id: message.id,
        msg: {
          type: 'request_permissions',
          call_id: 'permissions-1',
          permissions: { file_system: { read: true } },
        },
      })
      this.emit({ id: message.id, msg: { type: 'task_complete' } })
    }
  }

  onStdoutLine(callback: (line: string) => void): Unsubscribe {
    this.stdoutListeners.add(callback)
    return () => this.stdoutListeners.delete(callback)
  }

  onStderrLine(callback: (line: string) => void): Unsubscribe {
    this.stderrListeners.add(callback)
    return () => this.stderrListeners.delete(callback)
  }

  onExit(callback: (exit: CodexProcessExit) => void): Unsubscribe {
    this.exitListeners.add(callback)
    return () => this.exitListeners.delete(callback)
  }

  kill() {
    this.exitListeners.forEach((callback) => callback({ code: 0 }))
  }

  private emit(value: unknown) {
    const line = JSON.stringify(value)
    this.stdoutListeners.forEach((callback) => callback(line))
  }

  private emitStderr(line: string) {
    this.stderrListeners.forEach((callback) => callback(line))
  }
}

describe('CodexProtoSession', () => {
  it('starts codex proto and streams a turn through the app-server API facade', async () => {
    const process = new ScriptedProtoProcess()
    const spawner: CodexProcessSpawner = {
      spawn(command, args) {
        process.spawnArgs = [command, ...args]
        setTimeout(() => process.start(), 0)
        return process
      },
    }

    const client = await startCodexSession({
      spawner,
      options: {
        transport: 'proto',
        cwd: '/repo',
        model: 'gpt-test',
        approvalPolicy: 'on-request',
        mcpRefreshConfig: {
          mcp_servers: {
            fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
          },
          mcp_oauth_credentials_store_mode: 'auto',
        },
      },
    })

    const events = []
    for await (const event of client.sendToCodex('jan-thread-1', 'say hello', {
      clientUserMessageId: 'turn-1',
    })) {
      events.push(event)
    }

    client.approveAction('approval-1', { decision: 'approved' })
    client.approveAction('patch-approval-1', { decision: 'denied' })
    client.approveAction('user-input-1', {
      answers: { target_file: 'src/app.ts' },
    })
    client.approveAction('permissions-1', {
      permissions: { file_system: { read: true } },
      scope: 'session',
      strict_auto_review: true,
    })
    await client.interruptTurn('jan-thread-1')
    await client.compactThread('jan-thread-1')
    await client.reloadUserConfig()
    await client.refreshMcpServers()
    await client.runShellCommand('jan-thread-1', 'git status --short')
    await client.rollbackThread('jan-thread-1', 2)
    await client.startReview(
      'jan-thread-1',
      { type: 'baseBranch', branch: 'main' },
      { userFacingHint: 'review against main' } // defaults to detached for git review panel
    )
    await client.steerThread('codex-session-1', 'focus on tests', 'steer-1')
    await client.shutdownCodex()

    expect(process.spawnArgs).toEqual(['codex', 'proto'])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'thread_started',
          appThreadId: 'jan-thread-1',
          threadId: 'codex-session-1',
        }),
        expect.objectContaining({ type: 'turn_started', turnId: 'turn-1' }),
        expect.objectContaining({ type: 'assistant_delta', delta: 'hello' }),
        expect.objectContaining({
          type: 'approval_request',
          request: expect.objectContaining({ id: 'approval-1' }),
        }),
        expect.objectContaining({
          type: 'approval_request',
          request: expect.objectContaining({
            id: 'patch-approval-1',
            method: 'item/fileChange/requestApproval',
          }),
        }),
        expect.objectContaining({
          type: 'server_request',
          request: expect.objectContaining({
            id: 'user-input-1',
            method: 'item/tool/requestUserInput',
          }),
        }),
        expect.objectContaining({
          type: 'server_request',
          request: expect.objectContaining({
            id: 'permissions-1',
            method: 'item/permissions/requestApproval',
          }),
        }),
        expect.objectContaining({ type: 'turn_completed', turnId: 'turn-1' }),
      ])
    )
    expect(process.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'turn-1',
          op: expect.objectContaining({
            type: 'user_input',
            items: [{ type: 'text', text: 'say hello', text_elements: [] }],
          }),
          client_user_message_id: 'turn-1',
        }),
        expect.objectContaining({
          op: {
            type: 'exec_approval',
            id: 'approval-1',
            decision: 'approved',
          },
        }),
        expect.objectContaining({
          op: {
            type: 'patch_approval',
            id: 'patch-approval-1',
            decision: 'denied',
          },
        }),
        expect.objectContaining({
          op: {
            type: 'user_input_answer',
            id: 'user-input-1',
            response: { answers: { target_file: 'src/app.ts' } },
          },
        }),
        expect.objectContaining({
          op: {
            type: 'request_permissions_response',
            id: 'permissions-1',
            response: {
              permissions: { file_system: { read: true } },
              scope: 'session',
              strict_auto_review: true,
            },
          },
        }),
        expect.objectContaining({ op: { type: 'interrupt' } }),
        expect.objectContaining({ op: { type: 'compact' } }),
        expect.objectContaining({ op: { type: 'reload_user_config' } }),
        expect.objectContaining({
          op: {
            type: 'refresh_mcp_servers',
            config: {
              mcp_servers: {
                fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
              },
              mcp_oauth_credentials_store_mode: 'auto',
            },
          },
        }),
        expect.objectContaining({
          op: {
            type: 'run_user_shell_command',
            command: 'git status --short',
          },
        }),
        expect.objectContaining({
          op: {
            type: 'thread_rollback',
            num_turns: 2,
          },
        }),
        expect.objectContaining({
          op: {
            type: 'review',
            review_request: {
              target: { type: 'baseBranch', branch: 'main' },
              user_facing_hint: 'review against main',
            },
          },
        }),
        expect.objectContaining({
          id: 'steer-1',
          op: {
            type: 'user_input',
            items: [
              { type: 'text', text: 'focus on tests', text_elements: [] },
            ],
          },
          client_user_message_id: 'steer-1',
        }),
        expect.objectContaining({ op: { type: 'shutdown' } }),
      ])
    )
  })

  it('surfaces rejected proto submissions as stream errors', async () => {
    const process = new ScriptedProtoProcess()
    process.rejectUserInputSubmission = true
    const spawner: CodexProcessSpawner = {
      spawn(command, args) {
        process.spawnArgs = [command, ...args]
        setTimeout(() => process.start(), 0)
        return process
      },
    }

    const client = await startCodexSession({
      spawner,
      options: {
        transport: 'proto',
        cwd: '/repo',
        model: 'gpt-test',
      },
    })

    const events = []
    for await (const event of client.sendToCodex('jan-thread-1', 'say hello', {
      clientUserMessageId: 'turn-1',
    })) {
      events.push(event)
    }

    await client.shutdownCodex()

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          error: expect.objectContaining({
            message: expect.stringContaining(
              'Codex proto rejected a submission'
            ),
          }),
        }),
      ])
    )
  })
})
