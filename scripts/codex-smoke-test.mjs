#!/usr/bin/env node
/**
 * Smoke test for Codex app-server integration.
 *
 * Usage:
 *   node scripts/codex-smoke-test.mjs
 *   CODEX_APP_SERVER_BINARY=/path/to/codex node scripts/codex-smoke-test.mjs
 *
 * Optional local provider env:
 *   CODEX_SMOKE_BASE_URL=http://127.0.0.1:49366/v1
 *   CODEX_SMOKE_API_KEY=your-llamacpp-router-key
 *   CODEX_SMOKE_MODEL=Jan-v1-4B-Q4_K_M
 *   CODEX_SMOKE_PROVIDER=llamacpp
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'

const CODEX =
  process.env.CODEX_APP_SERVER_BINARY ??
  (process.platform === 'darwin'
    ? '/Applications/Codex.app/Contents/Resources/codex'
    : 'codex')

const useLocalProvider = Boolean(process.env.CODEX_SMOKE_BASE_URL)
const tempRoot = mkdtempSync(join(tmpdir(), 'jan-codex-smoke-'))
const codexHome = join(tempRoot, 'codex-home')
mkdirSync(codexHome, { recursive: true })

let mockServer
let providerPort

if (useLocalProvider) {
  const baseUrl = process.env.CODEX_SMOKE_BASE_URL.replace(/\/$/, '')
  const provider = process.env.CODEX_SMOKE_PROVIDER ?? 'llamacpp'
  const model = process.env.CODEX_SMOKE_MODEL ?? 'Jan-v1-4B-Q4_K_M'
  const apiKeyEnv = 'CODEX_SMOKE_API_KEY'
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      `model = ${JSON.stringify(model)}`,
      `model_provider = ${JSON.stringify(provider)}`,
      '',
      `[model_providers.${provider}]`,
      `name = ${JSON.stringify(provider)}`,
      `base_url = ${JSON.stringify(baseUrl)}`,
      `env_key = ${JSON.stringify(apiKeyEnv)}`,
      'wire_api = "responses"',
      '',
    ].join('\n')
  )
  process.env[apiKeyEnv] = process.env.CODEX_SMOKE_API_KEY ?? ''
} else {
  mockServer = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      if (req.url?.includes('/responses')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'resp_smoke',
            object: 'response',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'smoke-ok' }],
              },
            ],
          })
        )
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
  providerPort = mockServer.address().port
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      'model = "mock-model"',
      'model_provider = "mock"',
      '',
      '[model_providers.mock]',
      'name = "mock"',
      `base_url = "http://127.0.0.1:${providerPort}/v1"`,
      'env_key = "CODEX_SMOKE_MOCK_KEY"',
      'wire_api = "responses"',
      '',
    ].join('\n')
  )
  process.env.CODEX_SMOKE_MOCK_KEY = 'test'
}

const model = useLocalProvider
  ? (process.env.CODEX_SMOKE_MODEL ?? 'Jan-v1-4B-Q4_K_M')
  : 'mock-model'
const modelProvider = useLocalProvider
  ? (process.env.CODEX_SMOKE_PROVIDER ?? 'llamacpp')
  : 'mock'

const child = spawn(CODEX, ['app-server', '--stdio'], {
  cwd: tempRoot,
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
    LOG_FORMAT: 'json',
  },
})

const rl = createInterface({ input: child.stdout })
let nextId = 1
const pending = new Map()
const events = []
const stderr = []

child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line)
    if (msg.method) events.push(msg)
    if (msg.id && (msg.result !== undefined || msg.error)) {
      pending.get(msg.id)?.(msg)
    }
  } catch {
    // ignore non-json stdout
  }
})

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, (msg) => {
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

try {
  const init = await request('initialize', {
    clientInfo: { name: 'jan-smoke', title: 'Jan', version: '0.0.0' },
    capabilities: { experimentalApi: true },
  })
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)

  const thread = await request('thread/start', {
    model,
    modelProvider,
    cwd: tempRoot,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: false,
    serviceName: 'Jan',
  })

  await request('turn/start', {
    threadId: thread.thread.id,
    input: [
      {
        type: 'text',
        text: useLocalProvider
          ? 'Reply with exactly: jan-local-ok'
          : 'Say hello from the smoke test.',
        text_elements: [],
      },
    ],
    cwd: tempRoot,
    approvalPolicy: 'never',
    model,
  })

  const deadline = Date.now() + (useLocalProvider ? 120_000 : 30_000)
  while (
    Date.now() < deadline &&
    !events.some(
      (event) =>
        event.method === 'turn/completed' ||
        (event.method === 'error' && !event.params?.willRetry)
    )
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  const deltas = events
    .filter((event) => event.method === 'item/agentMessage/delta')
    .map((event) => event.params?.delta ?? '')
    .join('')
  const completed = events.some((event) => event.method === 'turn/completed')
  const fatalError = events.find(
    (event) => event.method === 'error' && !event.params?.willRetry
  )

  const result = {
    mode: useLocalProvider ? 'local-provider' : 'mock-provider',
    codexBinary: CODEX,
    userAgent: init.userAgent,
    threadId: thread.thread?.id,
    completed,
    assistantText: deltas.trim(),
    fatalError: fatalError?.params?.error?.message,
    notifications: [...new Set(events.map((event) => event.method))],
  }

  console.log(JSON.stringify(result, null, 2))

  if (!completed) {
    process.exitCode = 1
  } else if (useLocalProvider && !result.assistantText && result.fatalError) {
    process.exitCode = 2
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        failed: true,
        message: error instanceof Error ? error.message : String(error),
        stderr: stderr.join('').slice(0, 1000),
      },
      null,
      2
    )
  )
  process.exitCode = 1
} finally {
  child.kill()
  mockServer?.close()
  try {
    rmSync(tempRoot, { recursive: true, force: true })
  } catch {
    // Codex may leave temp plugin dirs behind on exit.
  }
}
