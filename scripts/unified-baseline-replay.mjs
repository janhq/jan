#!/usr/bin/env node
// Replays the first-turn request fixtures in qa/fixtures/unified-baseline/
// requests against a LOCAL OpenAI-compatible server (e.g. the llama-server Jan
// started) and records what bytes cannot: prompt tokens as the server counted
// them, time to first streamed delta, total latency and the server process's
// peak RSS. Protocol, caveats and what this does NOT measure:
// qa/unified-baseline-protocol.md.
//
//   node scripts/unified-baseline-replay.mjs --base-url http://127.0.0.1:PORT/v1 \
//     --model MODEL_ID [--api-key KEY] [--pid SERVER_PID] [--runs 3] [--warmup 1]
//     [--max-tokens 256] [--scenarios a,b] [--cache-prompt] [--out result.json]
//
// Loopback only: this must never send fixtures or keys to a remote provider.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const FIXTURE_DIR = new URL('../qa/fixtures/unified-baseline/requests/', import.meta.url)
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export function assertLoopback(baseUrl) {
  const url = new URL(baseUrl)
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`Refusing non-loopback base URL ${url.host}: local models only`)
  }
  return url.toString().replace(/\/$/, '')
}

export function loadScenarios(dir = FIXTURE_DIR, only) {
  return readdirSync(dir)
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
    .filter((s) => !only || only.includes(s.name))
}

/**
 * Resident set size in KiB, or null where `ps` cannot report it (Windows).
 * Async so sampling never blocks the stream reader whose timing it shares.
 */
export function rssKiB(pid) {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((done) =>
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], (err, out) => {
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
export async function runOnce({ baseUrl, apiKey, model, request, maxTokens, cachePrompt, pid }) {
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
  const sampler = startRssSampler(pid)
  const t0 = performance.now()
  let ttftMs = null, usage = null, timings = null, finishReason = null
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
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('text/event-stream'))
      throw new Error(`Expected an SSE stream, got "${type}": ${(await res.text()).slice(0, 300)}`)
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
        if (data === '[DONE]') continue
        const chunk = JSON.parse(data)
        const choice = chunk.choices?.[0]
        if (ttftMs == null && hasDelta(choice?.delta)) ttftMs = performance.now() - t0
        for (const call of choice?.delta?.tool_calls ?? [])
          if (call.function?.name) toolCalls.add(call.function.name)
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (chunk.usage) usage = chunk.usage
        if (chunk.timings) timings = chunk.timings
      }
    }
  } finally {
    peakRssKiB = await sampler.stop()
  }
  return {
    ttftMs, totalMs: performance.now() - t0,
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
  const scenarios = loadScenarios(opts.fixtureDir, opts.scenarios)
  if (!scenarios.length) throw new Error('No matching scenarios')
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
      cachePrompt: opts.cachePrompt, pidSampled: opts.pid ?? null,
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
    scenarios: values.scenarios?.split(','),
  })
  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n')
  console.log(toMarkdown(report))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
