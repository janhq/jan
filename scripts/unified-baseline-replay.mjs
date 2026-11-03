#!/usr/bin/env node
// Replays the first-turn request fixtures in qa/fixtures/unified-baseline/
// requests against a LOCAL OpenAI-compatible server (e.g. the llama-server Jan
// started) and records what bytes cannot: prompt tokens as the server counted
// them, time to first streamed delta, total latency and the server process's
// peak RSS (plus completion tokens, finish reason, tool calls and llama.cpp
// server timings when exposed). It does NOT measure output quality.
//
// Measurement notes:
// - Fixed inputs for comparable runs: temperature 0, max_tokens 256, 1 warm-up
//   + 3 measured runs, reported as medians. The CLI defaults for --max-tokens,
//   --warmup and --runs match; the actual values used are in the output.
// - Cold vs warm: without --cache-prompt each request asks llama.cpp not to
//   reuse the KV prefix (cold prefill); with it, repeat runs may hit the cache
//   (warm). Check cache-hit validity: if serverPromptTokens is much smaller than
//   promptTokens on runs after the first, the prefix cache was hit and the
//   "cold" numbers are not cold.
// - Peak RSS is resident memory of the single --pid process only: not VRAM, and
//   unified-memory GPU buffers may be under-counted. It is polled with `ps`
//   about every 100 ms (short peaks can be missed) and is unsupported on
//   Windows (reported as not measured).
//
//   node scripts/unified-baseline-replay.mjs --base-url http://127.0.0.1:PORT/v1 \
//     --model MODEL_ID [--api-key KEY] [--pid SERVER_PID] [--runs 3] [--warmup 1]
//     [--max-tokens 256] [--scenarios a,b] [--cache-prompt] [--timeout-ms 600000]
//     [--out result.json]
//
// Loopback only: this must never send fixtures or keys to a remote provider.
// It refuses non-loopback hosts, redirects, and Node's opt-in env proxy.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const FIXTURE_DIR = new URL('../qa/fixtures/unified-baseline/requests/', import.meta.url)
// Literal addresses only: a name like `localhost` goes through the resolver,
// which a hosts file can point anywhere.
const LOOPBACK = new Set(['127.0.0.1', '[::1]'])

export function assertLoopback(baseUrl) {
  const url = new URL(baseUrl)
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`Refusing base URL host ${url.host}: use 127.0.0.1 or [::1] (local models only)`)
  }
  return url.toString().replace(/\/$/, '')
}

/**
 * Node 24 fetch honours HTTP(S)_PROXY when NODE_USE_ENV_PROXY / --use-env-proxy
 * opts in, and then tunnels even 127.0.0.1 through the proxy (verified: a
 * CONNECT reached a trap proxy and the model got no request). Fail closed
 * whenever that opt-in meets any proxy variable, whatever NO_PROXY says.
 */
const PROXY_VARS = new Set(['http_proxy', 'https_proxy', 'all_proxy'])
export function assertNoEnvProxy(env = process.env, execArgv = process.execArgv) {
  // Deliberately blunt: names are matched in any case, and any mention of the
  // flag counts, because NODE_OPTIONS also accepts quoted forms such as
  // '"--use-env-proxy"' that a token parser could miss.
  const keys = Object.keys(env).filter((k) => env[k])
  const optIn = keys.some((k) => k.toUpperCase() === 'NODE_USE_ENV_PROXY') ||
    execArgv.some((a) => a.includes('use-env-proxy')) ||
    keys.some((k) => k.toUpperCase() === 'NODE_OPTIONS' && env[k].includes('use-env-proxy'))
  const set = keys.filter((k) => PROXY_VARS.has(k.toLowerCase()))
  if (optIn && set.length) {
    throw new Error(`Refusing to run: Node env proxy is enabled and ${set.join(', ')} is set, ` +
      'so loopback requests could be tunnelled through a proxy. Unset NODE_USE_ENV_PROXY ' +
      '(and --use-env-proxy in NODE_OPTIONS) or the proxy variables.')
  }
}

export function loadScenarios(dir = FIXTURE_DIR, only) {
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const raw = readFileSync(new URL(f, dir))
      return {
        name: basename(f, '.json'),
        sha256: createHash('sha256').update(raw).digest('hex'),
        request: JSON.parse(raw),
      }
    })
  if (!only) return all
  // A typo must not silently shrink the report.
  const unknown = only.filter((name) => !all.some((s) => s.name === name))
  if (unknown.length) {
    throw new Error(`Unknown scenario(s): ${unknown.join(', ')}. ` +
      `Available: ${all.map((s) => s.name).join(', ')}`)
  }
  return all.filter((s) => only.includes(s.name))
}

/**
 * Resident set size in KiB, or null where `ps` cannot report it (Windows).
 * Async so sampling never blocks the stream reader whose timing it shares.
 */
export function rssKiB(pid) {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((done) =>
    // Bounded: a stuck `ps` must not outlive the request timeout. Node kills
    // only this child on expiry, and the sample reads as unavailable.
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 2000 }, (err, out) => {
      const n = err ? NaN : Number.parseInt(String(out).trim(), 10)
      done(Number.isFinite(n) ? n : null)
    }))
}

function startRssSampler(pid, intervalMs = 100) {
  if (!pid) return { stop: async () => null }
  let peak = null, inFlight = null, stopped = false
  const sample = () => (inFlight ??= rssKiB(pid).then((v) => {
    if (v != null && (peak == null || v > peak)) peak = v
    inFlight = null
  }))
  sample()
  const timer = setInterval(() => { if (!stopped) sample() }, intervalMs)
  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await inFlight
      await sample()
      return peak
    },
  }
}

const hasDelta = (d) =>
  !!d && ((typeof d.content === 'string' && d.content.length > 0) ||
    (typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0) ||
    (Array.isArray(d.tool_calls) && d.tool_calls.length > 0))

/** One streamed request; times are wall-clock ms from just before fetch. */
export async function runOnce({ baseUrl, apiKey, model, request, maxTokens, cachePrompt, pid, timeoutMs = 600_000 }) {
  const body = {
    ...request,
    model,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
    max_tokens: maxTokens,
    // llama.cpp: without this a repeat run reuses the KV prefix and TTFT
    // measures a cache hit. Other servers ignore unknown fields.
    cache_prompt: cachePrompt,
  }
  // A local server can echo headers back; never print the key.
  const scrub = (text) => (apiKey ? text.split(apiKey).join('<redacted>') : text)
  const sampler = startRssSampler(pid)
  const t0 = performance.now()
  let ttftMs = null, totalMs = null, usage = null, timings = null, finishReason = null
  let sawDone = false
  const toolCalls = new Set()
  let peakRssKiB = null
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      // A loopback listener must not bounce fixtures or keys elsewhere.
      redirect: 'error',
      // Covers connect, headers and the whole streamed body.
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(scrub(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`))
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('text/event-stream'))
      throw new Error(scrub(`Expected an SSE stream, got "${type}": ${(await res.text()).slice(0, 300)}`))
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const bytes of res.body) {
      buffer += decoder.decode(bytes, { stream: true })
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          sawDone = true
          continue
        }
        let chunk
        try {
          chunk = JSON.parse(data)
        } catch {
          throw new Error(scrub(`Malformed SSE data: ${data.slice(0, 200)}`))
        }
        const choice = chunk.choices?.[0]
        if (ttftMs == null && hasDelta(choice?.delta)) ttftMs = performance.now() - t0
        for (const call of choice?.delta?.tool_calls ?? [])
          if (call.function?.name) toolCalls.add(call.function.name)
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (chunk.usage) usage = chunk.usage
        if (chunk.timings) timings = chunk.timings
      }
    }
    // Stamp the end before stopping the sampler so its work is not counted.
    totalMs = performance.now() - t0
    if (!sawDone && !finishReason)
      throw new Error('Stream ended without a finish_reason or [DONE]; run not counted')
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`Request exceeded ${timeoutMs} ms; run not counted`)
    throw e
  } finally {
    peakRssKiB = await sampler.stop()
  }
  return {
    ttftMs, totalMs,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    // llama.cpp server-side timings, when the server reports them.
    serverPromptMs: timings?.prompt_ms ?? null,
    serverPromptTokens: timings?.prompt_n ?? null,
    serverGenTokensPerSec: timings?.predicted_per_second ?? null,
    finishReason, toolCalls: [...toolCalls], peakRssKiB,
  }
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export async function replay(opts) {
  const baseUrl = assertLoopback(opts.baseUrl)
  assertNoEnvProxy(opts.env, opts.execArgv)
  const scenarios = loadScenarios(opts.fixtureDir, opts.scenarios)
  if (!scenarios.length) throw new Error('No scenarios')
  if (opts.pid && (await rssKiB(opts.pid)) == null) {
    // Report "not measured" honestly instead of a column of blanks.
    if (process.platform !== 'win32') throw new Error(`--pid ${opts.pid}: no such process`)
    console.warn('Peak RSS is not sampled on Windows; record memory separately.')
  }
  const results = []
  for (const s of scenarios) {
    const args = { ...opts, baseUrl, request: s.request }
    for (let i = 0; i < opts.warmup; i++) await runOnce(args)
    const runs = []
    for (let i = 0; i < opts.runs; i++) runs.push(await runOnce(args))
    const summary = {}
    for (const k of ['promptTokens', 'ttftMs', 'totalMs', 'serverPromptMs', 'peakRssKiB'])
      summary[k] = median(runs.map((r) => r[k]))
    results.push({ scenario: s.name, fixtureSha256: s.sha256, median: summary, runs })
  }
  return {
    kind: 'unified-baseline-replay',
    note: 'First-turn request fixtures replayed directly against a local server; not an in-app measurement.',
    recordedAt: new Date().toISOString(),
    host: {
      platform: process.platform, release: os.release(), arch: process.arch,
      cpu: os.cpus()[0]?.model ?? null, totalMemBytes: os.totalmem(), node: process.version,
    },
    settings: {
      model: opts.model, runs: opts.runs, warmup: opts.warmup, maxTokens: opts.maxTokens,
      cachePrompt: opts.cachePrompt, pidSampled: opts.pid ?? null, timeoutMs: opts.timeoutMs ?? 600_000,
    },
    results,
  }
}

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d))
export function toMarkdown(report) {
  const rows = report.results.map(({ scenario, median: m }) =>
    `| ${scenario} | ${fmt(m.promptTokens)} | ${fmt(m.ttftMs)} | ${fmt(m.totalMs)} | ${fmt(m.serverPromptMs)} | ${m.peakRssKiB == null ? '—' : fmt(m.peakRssKiB / 1024)} |`)
  return [
    `Model \`${report.settings.model}\`, ${report.host.platform}/${report.host.arch}, ${report.host.cpu}; ` +
      `${report.settings.warmup} warm-up + ${report.settings.runs} runs, median; cache_prompt=${report.settings.cachePrompt}.`,
    '',
    '| Scenario | Prompt tokens | TTFT ms | Total ms | Server prompt ms | Peak server RSS MiB |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

async function main() {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string' }, model: { type: 'string' },
      'api-key': { type: 'string' }, pid: { type: 'string' },
      runs: { type: 'string', default: '3' }, warmup: { type: 'string', default: '1' },
      'max-tokens': { type: 'string', default: '256' }, scenarios: { type: 'string' },
      'cache-prompt': { type: 'boolean', default: false }, out: { type: 'string' },
      'timeout-ms': { type: 'string', default: '600000' },
    },
  })
  if (!values['base-url'] || !values.model) {
    console.error('Usage: --base-url http://127.0.0.1:PORT/v1 --model ID [--pid N] ... (see header)')
    process.exit(2)
  }
  const int = (name, min) => {
    const n = Number(values[name])
    if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}`)
    return n
  }
  const report = await replay({
    baseUrl: values['base-url'], model: values.model,
    apiKey: values['api-key'] ?? process.env.UNIFIED_BASELINE_API_KEY,
    pid: values.pid ? int('pid', 1) : undefined,
    runs: int('runs', 1), warmup: int('warmup', 0),
    maxTokens: int('max-tokens', 1), cachePrompt: values['cache-prompt'],
    timeoutMs: int('timeout-ms', 1),
    scenarios: values.scenarios?.split(','),
  })
  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n')
  console.log(toMarkdown(report))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    // fetch hides the reason (refused connection, refused redirect) in `cause`.
    console.error(e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message)
    process.exit(1)
  })
}
