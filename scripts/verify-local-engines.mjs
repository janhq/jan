#!/usr/bin/env node
/**
 * End-to-end check for Jan's local CPU inference engines.
 *
 * Starts the same sidecar the desktop app runs (the OpenAI-compatible server
 * the `tauri-plugin-local-engine` plugin embeds), asks it a question, and
 * prints the answer. Use it to confirm that a runtime and a model actually
 * work on this machine:
 *
 *   node scripts/verify-local-engines.mjs \
 *     --engine litert-lm \
 *     --python /path/to/venv/bin/python \
 *     --model /path/to/model.litertlm
 *
 *   node scripts/verify-local-engines.mjs \
 *     --engine openvino \
 *     --python /path/to/venv/bin/python \
 *     --model /path/to/model-dir
 *
 * Exits non-zero when the engine cannot start or does not answer.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const serverScript = resolve(join(here, '..', 'src-tauri', 'python-engines', 'server.py'))

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (!args.engine || !args.python || !args.model) {
  console.error(
    'usage: verify-local-engines.mjs --engine <litert-lm|openvino> --python <interpreter> --model <path>'
  )
  process.exit(2)
}

if (!existsSync(serverScript)) {
  console.error(`the engine server script is missing: ${serverScript}`)
  process.exit(2)
}

const port = Number(args.port || 0) || 9500 + Math.floor(Math.random() * 400)
const host = '127.0.0.1'
const prompt = String(args.prompt || 'Reply with exactly the word: engine-ok')
const maxTokens = Number(args['max-tokens'] || 64)

const child = spawn(
  args.python,
  [
    serverScript,
    '--engine',
    String(args.engine),
    '--model',
    String(args.model),
    '--model-id',
    String(args['model-id'] || 'verify'),
    '--host',
    host,
    '--port',
    String(port),
    '--ctx-size',
    String(args['ctx-size'] || 2048),
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] }
)

let exited = false
child.on('exit', (code) => {
  exited = true
  if (code !== 0 && code !== null) {
    console.error(`the engine server exited with code ${code}`)
  }
})

function stop() {
  if (!exited) child.kill()
}

async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error('the engine server exited before it became ready')
    try {
      const response = await fetch(`http://${host}:${port}/health`)
      if (response.ok) return await response.json()
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('the engine server did not become ready in time')
}

async function streamChat() {
  const response = await fetch(`http://${host}:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: String(args['model-id'] || 'verify'),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`chat failed: HTTP ${response.status} ${await response.text()}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        const parsed = JSON.parse(payload)
        if (parsed.error) throw new Error(parsed.error.message)
        const delta = parsed.choices?.[0]?.delta ?? {}
        if (delta.content) {
          content += delta.content
          process.stdout.write(delta.content)
        }
        if (delta.reasoning_content) reasoning += delta.reasoning_content
      }
      boundary = buffer.indexOf('\n\n')
    }
  }

  return { content, reasoning }
}

try {
  console.log(`starting the ${args.engine} engine on port ${port}...`)
  const health = await waitForHealth()
  console.log(`engine ready: ${JSON.stringify(health)}`)
  console.log('--- completion ---')
  const result = await streamChat()
  console.log('\n--- end ---')
  if (result.reasoning) {
    console.log(`reasoning: ${result.reasoning.slice(0, 200)}`)
  }
  if (!result.content.trim()) {
    console.error('the engine produced no answer')
    process.exitCode = 1
  } else {
    // A generation that stops early still returns text, so the check is on
    // the shape of the answer: a reply that ends mid-sentence means the
    // engine was cut off rather than finished.
    const trimmed = result.content.trim()
    const endsCleanly = /[.!?)\]}"'`]$/.test(trimmed)
    if (!endsCleanly) {
      console.error(
        `the answer looks cut off (it does not end a sentence): ${JSON.stringify(
          trimmed.slice(-80)
        )}`
      )
      process.exitCode = 1
    } else {
      console.log(`ok: the ${args.engine} engine answered`)
    }
  }
} catch (error) {
  console.error(`verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  stop()
}
