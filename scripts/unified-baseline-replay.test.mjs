// Mechanics only, against a fake loopback server: proves the replay parses a
// streamed response and records timings/usage. Says nothing about real models.
//   node --test scripts/unified-baseline-replay.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { assertLoopback, assertNoEnvProxy, loadScenarios, replay, toMarkdown } from './unified-baseline-replay.mjs'

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

test('rejects unknown --scenarios even alongside valid ones', () => {
  assert.throws(() => loadScenarios(undefined, ['chat-bare', 'cowork-exec']), /Unknown scenario\(s\): cowork-exec\. Available: /)
  assert.deepEqual(loadScenarios(undefined, ['chat-bare']).map((s) => s.name), ['chat-bare'])
})

test('fails closed when Node env proxy meets any proxy variable', () => {
  const P = 'http://127.0.0.1:9'
  for (const v of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    assert.throws(() => assertNoEnvProxy({ NODE_USE_ENV_PROXY: '1', [v]: P }, []), /Refusing to run/, v)
    assert.throws(() => assertNoEnvProxy({ NODE_OPTIONS: '--max-old-space-size=99 --use-env-proxy', [v]: P }, []), /Refusing/, v)
    assert.throws(() => assertNoEnvProxy({ [v]: P }, ['--use-env-proxy']), /Refusing/, v)
    assert.doesNotThrow(() => assertNoEnvProxy({ [v]: P }, []), v) // no opt-in: Node ignores it
  }
  // NO_PROXY is not trusted to save us.
  assert.throws(() => assertNoEnvProxy({ NODE_USE_ENV_PROXY: '1', HTTP_PROXY: P, NO_PROXY: '127.0.0.1' }, []), /Refusing/)
  assert.doesNotThrow(() => assertNoEnvProxy({ NODE_USE_ENV_PROXY: '1' }, []))
})

/** Fake model + trap proxy; the CLI runs as a bounded child; only its PID is killed. */
async function runCliAgainstTraps(extraEnv) {
  const hits = { model: 0, proxy: 0 }
  const model = createServer((req, res) => { req.resume(); hits.model++; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(sse({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n') })
  const proxy = createServer((req, res) => { req.resume(); hits.proxy++; res.writeHead(502); res.end() })
  proxy.on('connect', (_req, sock) => { hits.proxy++; sock.end('HTTP/1.1 502 trap\r\n\r\n') })
  const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)))
  try {
    const mp = await listen(model), pp = await listen(proxy)
    const env = { PATH: process.env.PATH, ...extraEnv(`http://127.0.0.1:${pp}`) }
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [new URL('./unified-baseline-replay.mjs', import.meta.url).pathname,
        '--base-url', `http://127.0.0.1:${mp}/v1`, '--model', 'x', '--runs', '1', '--warmup', '0',
        '--scenarios', 'chat-bare', '--timeout-ms', '5000'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d))
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }) })
    })
    return { ...result, hits }
  } finally {
    for (const s of [model, proxy]) { s.closeAllConnections(); s.close() }
  }
}

test('CLI refuses to run under an env proxy: nothing reaches the proxy or the model', async () => {
  for (const make of [(p) => ({ NODE_USE_ENV_PROXY: '1', HTTP_PROXY: p }), (p) => ({ NODE_USE_ENV_PROXY: '1', http_proxy: p }),
    (p) => ({ NODE_OPTIONS: '--use-env-proxy', https_proxy: p, HTTP_PROXY: p })]) {
    const r = await runCliAgainstTraps(make)
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /Refusing to run: Node env proxy/)
    assert.deepEqual(r.hits, { model: 0, proxy: 0 })
  }
  const direct = await runCliAgainstTraps(() => ({}))
  assert.equal(direct.code, 0, direct.out)
  assert.deepEqual(direct.hits, { model: 1, proxy: 0 })
})

test('a stalled server hits the request timeout instead of hanging', async () => {
  const server = createServer((req) => req.resume()) // never answers
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await assert.rejects(replay({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'x', runs: 1, warmup: 0,
      maxTokens: 1, cachePrompt: false, scenarios: ['chat-bare'], timeoutMs: 300 }), /exceeded 300 ms/)
  } finally {
    server.closeAllConnections(); server.close()
  }
})
