import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { buildCodexConfigToml } from '../config'
import { CodexAppServerSession } from '../client'
import type { CodexProcessSpawner, CodexSpawnOptions } from '../process-manager'
import type { CodexProcess, CodexProcessExit, Unsubscribe } from '../types'

const DEFAULT_CODEX_BINARY = '/Applications/Codex.app/Contents/Resources/codex'
const CODEX_BINARY = process.env.CODEX_APP_SERVER_BINARY ?? DEFAULT_CODEX_BINARY
const liveIt = existsSync(CODEX_BINARY) ? it : it.skip

class NodeCodexProcess implements CodexProcess {
  private readonly stdoutListeners = new Set<(line: string) => void>()
  private readonly stderrListeners = new Set<(line: string) => void>()
  private readonly exitListeners = new Set<(exit: CodexProcessExit) => void>()
  private exited = false

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      this.stdoutListeners.forEach((callback) => callback(line))
    })
    createInterface({ input: child.stderr }).on('line', (line) => {
      this.stderrListeners.forEach((callback) => callback(line))
    })
    child.on('exit', (code, signal) => {
      this.exited = true
      this.exitListeners.forEach((callback) => callback({ code, signal }))
    })
  }

  writeLine(line: string) {
    this.child.stdin.write(`${line}\n`)
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

  async kill() {
    if (this.exited) return
    this.child.kill()
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1_000)
      this.child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
}

class NodeCodexProcessSpawner implements CodexProcessSpawner {
  spawn(command: string, args: string[], options: CodexSpawnOptions) {
    if (options.codexHome && options.configToml) {
      mkdirSync(options.codexHome, { recursive: true })
      writeFileSync(join(options.codexHome, 'config.toml'), options.configToml)
    }

    return new NodeCodexProcess(
      spawn(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
      })
    )
  }
}

type CapturedRequest = {
  method: string | undefined
  url: string | undefined
  body: string
}

describe('Codex app-server live integration', () => {
  liveIt(
    'starts the real app-server, sends one turn through an isolated mock provider, and streams assistant output',
    async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), 'jan-codex-live-'))
      const codexHome = join(tempRoot, 'codex-home')
      const workspace = join(tempRoot, 'workspace')
      mkdirSync(workspace, { recursive: true })

      const capturedRequests: CapturedRequest[] = []
      const server = createServer((request, response) => {
        handleMockResponsesRequest(request, response, capturedRequests)
      })

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve())
      })

      const port = (server.address() as AddressInfo).port
      const session = new CodexAppServerSession({
        spawner: new NodeCodexProcessSpawner(),
        options: {
          codexBinaryPath: CODEX_BINARY,
          codexHome,
          configToml: buildCodexConfigToml({
            model: 'mock-model',
            modelProvider: 'mock',
            providers: [
              {
                id: 'mock',
                name: 'mock',
                baseUrl: `http://127.0.0.1:${port}/v1`,
                apiKeyEnvVar: 'JAN_CODEX_MOCK_API_KEY',
                wireApi: 'responses',
              },
            ],
          }),
          cwd: workspace,
          model: 'mock-model',
          modelProvider: 'mock',
          approvalPolicy: 'never',
          sandbox: 'read-only',
          env: {
            JAN_CODEX_MOCK_API_KEY: 'test-key',
          },
        },
      })

      try {
        const events = []
        for await (const event of session.sendMessage({
          appThreadId: 'jan-live-thread',
          clientUserMessageId: 'jan-live-message',
          text: 'Say hello from the mock provider.',
        })) {
          events.push(event)
        }

        expect(capturedRequests).toEqual([
          expect.objectContaining({
            method: 'POST',
            url: '/v1/responses',
            body: expect.stringContaining('"model":"mock-model"'),
          }),
        ])
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'thread_started' }),
            expect.objectContaining({ type: 'turn_started' }),
            expect.objectContaining({
              type: 'assistant_delta',
              delta: 'hello from mock',
            }),
            expect.objectContaining({ type: 'turn_completed' }),
          ])
        )
      } finally {
        await session.shutdown()
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
        rmSync(tempRoot, { recursive: true, force: true })
      }
    },
    60_000
  )
})

function handleMockResponsesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  capturedRequests: CapturedRequest[]
) {
  let body = ''
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8')
  })
  request.on('end', () => {
    capturedRequests.push({
      method: request.method,
      url: request.url,
      body,
    })

    if (request.url !== '/v1/responses') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }

    response.writeHead(200, { 'content-type': 'text/event-stream' })
    mockResponseEvents().forEach((event) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    response.write('data: [DONE]\n\n')
    response.end()
  })
}

function mockResponseEvents() {
  return [
    {
      type: 'response.created',
      response: {
        id: 'resp_1',
        object: 'response',
        status: 'in_progress',
        output: [],
      },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
      },
    },
    {
      type: 'response.content_part.added',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '' },
    },
    {
      type: 'response.output_text.delta',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      delta: 'hello from mock',
    },
    {
      type: 'response.output_text.done',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      text: 'hello from mock',
    },
    {
      type: 'response.content_part.done',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: 'hello from mock' },
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'hello from mock' }],
      },
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        object: 'response',
        status: 'completed',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'hello from mock' }],
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 3,
          total_tokens: 4,
        },
      },
    },
  ]
}
