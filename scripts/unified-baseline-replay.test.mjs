// Mechanics only, against a fake loopback server: proves the replay parses a
// streamed response and records timings/usage. Says nothing about real models.
//   node --test scripts/unified-baseline-replay.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { assertLoopback, loadScenarios, replay, toMarkdown } from './unified-baseline-replay.mjs'

const sse = (o) => `data: ${JSON.stringify(o)}\n\n`

test('refuses anything but loopback', () => {
  assert.throws(() => assertLoopback('https://api.openai.com/v1'), /Refusing base URL host/)
  assert.throws(() => assertLoopback('http://10.0.0.5:8080/v1'), /Refusing base URL host/)
  assert.throws(() => assertLoopback('http://localhost:1/v1'), /use 127.0.0.1/)
  assert.equal(assertLoopback('http://127.0.0.1:1/v1/'), 'http://127.0.0.1:1/v1')
  assert.equal(assertLoopback('http://[::1]:1/v1'), 'http://[::1]:1/v1')
})

test('committed fixtures are loadable OpenAI-style requests', () => {
  const scenarios = loadScenarios()
  assert.ok(scenarios.length >= 2)
  for (const s of scenarios) {
    assert.equal(s.request.messages.at(-1).role, 'user')
    assert.equal(s.request.stream, undefined, 'fixtures carry no sampling/stream options')
  }
})

test('records TTFT, total, usage, timings and tool calls from a stream', async () => {
  const bodies = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      bodies.push(JSON.parse(raw))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(sse({ choices: [{ delta: { role: 'assistant' } }] }))
      setTimeout(() => {
        res.write(sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'read', arguments: '' } }] } }] }))
        setTimeout(() => {
          res.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
          res.write(sse({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 3 }, timings: { prompt_n: 42, prompt_ms: 12.5 } }))
          res.end('data: [DONE]\n\n')
        }, 30)
      }, 20)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const report = await replay({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fake',
      runs: 2, warmup: 1, maxTokens: 8, cachePrompt: false, pid: process.pid,
      scenarios: ['chat-bare'],
    })
    assert.equal(bodies.length, 3) // 1 warm-up + 2 measured
    assert.equal(bodies[0].cache_prompt, false)
    assert.equal(bodies[0].temperature, 0)
    const [result] = report.results
    for (const run of result.runs) {
      assert.ok(run.ttftMs >= 15 && run.ttftMs <= run.totalMs, JSON.stringify(run))
      assert.equal(run.promptTokens, 42)
      assert.equal(run.serverPromptMs, 12.5)
      assert.deepEqual(run.toolCalls, ['read'])
      assert.equal(run.finishReason, 'tool_calls')
      if (process.platform !== 'win32') assert.ok(run.peakRssKiB > 0)
    }
    assert.match(toMarkdown(report), /\| chat-bare \| 42 \|/)
  } finally {
    server.close()
  }
})

test('refuses redirects and non-SSE replies instead of following or misparsing', async () => {
  const server = createServer((req, res) => {
    req.resume()
    if (req.url.startsWith('/redirect')) {
      res.writeHead(307, { location: 'http://example.invalid/v1/chat/completions' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>not a model</html>')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const opts = { model: 'fake', runs: 1, warmup: 0, maxTokens: 8, cachePrompt: false, scenarios: ['chat-bare'] }
  try {
    await assert.rejects(replay({ ...opts, baseUrl: `${base}/redirect/v1` }), /fetch failed|redirect/i)
    await assert.rejects(replay({ ...opts, baseUrl: `${base}/v1` }), /Expected an SSE stream/)
  } finally {
    server.close()
  }
})

test('fails fast on a --pid that does not exist rather than reporting blank memory', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(
    replay({ baseUrl: 'http://127.0.0.1:9/v1', model: 'x', runs: 1, warmup: 0, maxTokens: 1, cachePrompt: false, pid: 2 ** 22 + 12345, scenarios: ['chat-bare'] }),
    /no such process/
  )
})

test('redacts an echoed key and rejects truncated streams', async () => {
  const server = createServer((req, res) => {
    req.resume()
    if (req.url.startsWith('/echo')) {
      res.writeHead(401, { 'content-type': 'text/plain' })
      return res.end(`bad key: ${req.headers.authorization}`)
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(sse({ choices: [{ delta: { content: 'O' } }] })) // no finish_reason, no [DONE]
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const opts = { model: 'x', runs: 1, warmup: 0, maxTokens: 1, cachePrompt: false, scenarios: ['chat-bare'], apiKey: 'sekrit-key-42' }
  try {
    await assert.rejects(replay({ ...opts, baseUrl: `${base}/echo/v1` }), (e) =>
      !e.message.includes('sekrit-key-42') && e.message.includes('<redacted>'))
    await assert.rejects(replay({ ...opts, baseUrl: `${base}/v1` }), /without a finish_reason/)
  } finally {
    server.close()
  }
})
