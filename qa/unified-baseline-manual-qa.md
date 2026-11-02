# Unified baseline harness: manual QA record (2026-11-02)

Manual verification of the jan-internal#506 preparation (janhq/jan#9532),
beyond its unit tests. **Every server here is a synthetic loopback fake. The
token, TTFT and RSS values below only prove the CLI records what a server
sends, and that its timing works. They say nothing about any real model.** No
real model, provider, credential or Jan data was used.

Host: macOS 26 (Darwin 25.6.0) arm64, Node v24.18.0. First pass on `1d0f5b4ca`;
rows marked † were re-run after the review fixes (next commit).

## Harness

A synthetic OpenAI-compatible SSE server on `127.0.0.1:18901`, with a "trap"
server on `:18902`. The CLI runs with a preload that logs every *established*
outbound TCP connection and every `dns.lookup` call (the path `fetch` uses).
Failed connection attempts are not logged; trap hit counts on the server side
cover redirects. Sources are at the end of this file. The server sends
a role-only delta at t=0, the first content or tool-call delta at about 300 ms
and the end at about 500 ms. It returns `usage.prompt_tokens = 1000 + tool
count` and llama.cpp-style `timings` (`prompt_n` 1000, `prompt_ms` 42.5),
except in `nousage` mode.

```sh
node fake-server.mjs 18901 18902 server.log &
NETLOG=net.log node --import ./netlog.mjs scripts/unified-baseline-replay.mjs <args>
```

## Results

| Case | Command (after `--model synthetic`) | Result |
|---|---|---|
| Success, all scenarios | `--base-url http://127.0.0.1:18901/ok/v1 --api-key qa-dummy-key-123 --pid <server pid> --runs 3 --warmup 1 --out ok.json` | exit 0; 6 scenarios × 4 requests = 24 server hits; TTFT 305–306 ms (role-only chunk correctly ignored), total 512–518 ms, prompt tokens 1000–1012 as sent, peak RSS 60–61 MiB of the server PID; only socket `127.0.0.1:18901` |
| Body sent | same | every request had `stream:true`, `stream_options.include_usage`, `temperature:0`, `max_tokens:256`, `cache_prompt:false`, `Authorization` present; tools 0/1/7/11/12 per fixture; no extra fields |
| Key hygiene | same | `qa-dummy-key-123` absent from stdout, stderr and `ok.json` |
| `--cache-prompt` | `... --cache-prompt` | server received `cache_prompt:true` |
| No usage/timings | `/nousage/v1` | prompt tokens and server prompt ms printed as `—` (null in JSON), not invented |
| No `--pid` | `/tool/v1` (first pass via `localhost`) | peak RSS `—`; `toolCalls:["read"]`, `finishReason:"tool_calls"`; one DNS lookup `localhost`, socket `127.0.0.1:18901` |
| `localhost` † | `http://localhost:18901/ok/v1` | now refused before any lookup: literal `127.0.0.1` / `[::1]` only (review finding) |
| `[::1]` † | `http://[::1]:18901/ok/v1` | accepted by the guard; `ECONNREFUSED ::1:18901` because the fake listens on IPv4 only |
| Success after fixes † | `/ok/v1 --scenarios cowork-execute --pid <server pid>` | exit 0; TTFT 312 ms, total 515 ms, peak RSS 54 MiB; 0 trap hits overall |
| Redirect | `/redirect/v1` (307 to trap `:18902`) | exit 1 `fetch failed: unexpected redirect`; **0 trap hits**; only socket `:18901` |
| Non-SSE 200 | `/html/v1` | exit 1 `Expected an SSE stream, got "text/html": ...` |
| HTTP 500 | `/err500/v1` | exit 1 `HTTP 500: {"error":"synthetic failure"}` |
| Server down | `http://127.0.0.1:18999/v1` | exit 1 `fetch failed: connect ECONNREFUSED 127.0.0.1:18999` |
| Non-loopback | `https://api.openai.com/v1`, `127.0.0.1.nip.io`, `127.0.0.1@example.com`, `[::ffff:127.0.0.1]`, `0.0.0.0` | all refused before any socket or DNS lookup (net log empty for these) |
| Loopback aliases | `127.1`, `2130706433` | accepted: the URL parser normalizes both to `127.0.0.1`, and the net log confirms the connection went there |
| Bad args | `--runs 0`, `--runs abc`, `--warmup=-1`, `--max-tokens 1.5`, `--pid 0` | exit 1 with `--<name> must be an integer >= N` |
| Missing model / unknown scenario | no `--model`; `--scenarios nope` | exit 2 usage; exit 1 `No matching scenarios` |
| Nonexistent PID | `--pid 999999` | exit 1 `--pid 999999: no such process` |

Findings fixed during this QA. In `1d0f5b4ca`: A nonexistent `--pid`
had silently produced a blank memory column. Redirect and connection failures
had printed only `fetch failed`, with no reason. Before the fix the redirect
was already refused, with 0 trap hits.

## Independent review

Reviewer: the Jan Agent (`jan 0.8.8-69`, `jan cli agent run --sandbox`) with
its default config. The default model is Claude Fable, not Codex. It ran
read-only on a detached snapshot of `1d0f5b4ca` plus this harness and its
outputs. It confirmed:

- TTFT of 304–317 ms ignores the role-only chunk.
- The request body fields are as specified.
- There were 0 trap hits.
- Missing usage and RSS stay null.
- Medians and fixture hashes match.
- Bytes are not presented as tokens or performance, and no budgets are set.

Two of its replay tests failed because its sandbox denied spawning `ps`
(EPERM). That is the reviewer's environment, not the code. Its findings, all
fixed in the follow-up commit († rows above):

| Severity | Finding | Fix |
|---|---|---|
| Medium | A local server that echoes the `Authorization` header could put the key into error output | The key is redacted from all error text; regression test added |
| Medium | `localhost` is resolved through the hosts file | Only literal `127.0.0.1` / `[::1]` are accepted |
| Medium | `totalMs` included sampler shutdown | Total is stamped before the sampler stops |
| Medium | A truncated or empty stream counted as a run | Rejected unless there is a `finish_reason` or `[DONE]`; regression test added |
| Low | Regeneration commands in the protocol used the wrong cwd | Vitest runs in a subshell |
| Low | The net log claim overstated coverage | Narrowed (see Harness) |

An earlier Claude (Fable) subagent review, before the PR opened, found 8
low/medium items. Those were fixed in `c8ee0623b`.

## Fixture stability and drift

- `node scripts/capture-cowork-schema-fixture.mjs` (regenerate), then the
  baseline vitest twice and once under `TZ=Asia/Kolkata`: 8/8 each. All 8
  fixture files are byte-identical (sha256) to the committed ones. Earlier runs
  also passed under `TZ=Pacific/Kiritimati` and `TZ=Pacific/Pago_Pago`.
- Drift: one description in `schema.rs` was edited temporarily.
  `capture --check` exited 1 with "Schema fixture drift", and the vitest
  provenance test failed (1 failed, 7 passed). After `git checkout` of the file,
  both were clean again.

## Unit and regression checks at this commit

`node --test scripts/unified-baseline-replay.test.mjs` 6/6 after the review fixes. The baseline
vitest is 8/8; related chat and Cowork suites are 139/139. `yarn tsc -b`
is clean. `yarn test:web`: 4871/4871 tests. One file
(`services/core/__tests__/tauri.test.ts`) fails to load because the bundled
`@janhq/assistant-extension` package is not built in this checkout. That is
an environment issue, not something this change touches.

## Round 3: Jan Reviewer findings, rebased onto `d60efe046`

The branch was rebased onto the integration head `d60efe046` (after #9531).
#9531 adds dispatch-time refusals (`unadvertisedToolRefusal`,
`capabilityModeRefusal`) and changes no advertised tool or prompt. The
baseline vitest passed without `-u`, and regenerating gave no diff, so the
fixtures needed no regeneration.

**Env proxy risk, verified before the fix (Node v24.18.0).** A bounded probe
ran the CLI against an in-process fake model plus a trap proxy:

| Environment | Model hits | Proxy hits |
|---|---|---|
| `NODE_USE_ENV_PROXY=1` with `HTTP_PROXY` or `http_proxy` | 0 | 1 (`CONNECT 127.0.0.1:<port>`) |
| `NODE_OPTIONS=--use-env-proxy` with `HTTP_PROXY` | 0 | 1 |
| Opt-in with `HTTPS_PROXY`, or `NO_PROXY=127.0.0.1` | 1 | 0 (direct) |
| Proxy variables without the opt-in | 1 | 0 (direct) |

So the loopback guarantee did not hold under Node's opt-in env proxy. (A first,
unbounded probe hung because its fake proxy did not answer `CONNECT`. The
probes since then bound every child with a deadline and kill only the
recorded child PID.)

**After the fix**, the bounded runner `qa-run.mjs` used in-process servers
closed in `finally`. Each CLI run was a child with a 20 s deadline; none was
hit:

| Case | Result |
|---|---|
| Opt-in (`NODE_USE_ENV_PROXY=1` or `NODE_OPTIONS=--use-env-proxy`) with `HTTP_PROXY`, `http_proxy`, `HTTPS_PROXY`, `https_proxy`, or `HTTP_PROXY` + `NO_PROXY=127.0.0.1` | exit 1 `Refusing to run: Node env proxy is enabled ...`; 0 model, 0 proxy, 0 trap hits |
| Proxy variables without the opt-in; opt-in without a proxy variable | exit 0, 1 model hit, 0 proxy hits |
| `--scenarios chat-bare,cowork-exec` | exit 1 `Unknown scenario(s): cowork-exec. Available: ...`; 0 requests sent |
| `--scenarios chat-bare,cowork-plan` | exit 0, 2 requests |
| Redirect to the trap | exit 1 `fetch failed: unexpected redirect`, 0 trap hits |
| Server never answers, `--timeout-ms 500` | exit 1 after 527 ms, `Request exceeded 500 ms; run not counted` |
| Stalls mid-stream after one chunk, `--timeout-ms 500` | exit 1 after 546 ms, same message |
| `--timeout-ms 0` | exit 1 `--timeout-ms must be an integer >= 1` |

**Proof that the new checks can fail.** Each file was edited temporarily and
restored with `git checkout`:

- Env-proxy guard call removed: the trap-proxy node test fails (1 of 10), and
  so does the vitest wrapper (1 failed).
- One description hand-edited in `builtin-schemas.json`: `--check` exits 1,
  and the vitest fixture test fails.
- `schema.rs` and the fixture converted to CRLF: `--check` is clean and the
  vitest passes 8/8. This first exposed a bug in my test's synthetic CRLF
  case, which doubled `\r` on CRLF input; it was fixed before commit.
- One replay assertion broken: the vitest wrapper fails, so CI would catch it.

**Checks at the final head:**

- `node scripts/capture-cowork-schema-fixture.mjs --check`: clean, and
  regenerating gives no diff.
- `node --test scripts/unified-baseline-replay.test.mjs`: 10/10.
- Vitest for the baseline, replay wrapper and related chat/Cowork suites
  (including #9531's `coworkDispatch` and `coworkSubagent`): 264/264.
- `yarn tsc -b`: clean. The new test files typecheck clean separately.
- `node --check` on both scripts: ok. ESLint ignores test files by repo
  config, and there is no root ESLint for `scripts/`.
- `yarn test:web`: 4912 passed, 4 failed. The 4 failures are in
  `routes/__tests__/coworkSkills.test.tsx` (lines 537 and 612 assert
  `expected undefined to be 1`). The file fails the same 4 on a pristine
  `d60efe046` worktree and passes 11/11 on the previous parent `753bbc96c`,
  so the #9531 merge introduced them, not this branch. This branch changes
  only two new test files under `web-app/`. Plus the known environment-only
  `tauri.test.ts` load failure (unbuilt `@janhq/assistant-extension`).

### Round 3b: independent Jan Agent review of `0d790e236`

Reviewer: the Jan Agent with its default config (Claude Fable), read-only and
sandboxed on a detached snapshot, scoped to `git diff 7d571a84c HEAD`. In its
sandbox the replay suite passed 8/10; the 2 failures were its sandbox
blocking `ps` (EPERM), and the trap-proxy and timeout tests passed. It
confirmed the CRLF handling, the vitest wiring, owned-child kills, and the
source citations for both documented production behaviours. Findings, all
fixed in the next commit:

| Severity | Finding | Fix and verification |
|---|---|---|
| High | Quoted `NODE_OPTIONS='"--use-env-proxy"'` bypassed the flag regex | Any mention of `use-env-proxy` in `NODE_OPTIONS` or execArgv counts, and opt-in and proxy names match in any case. Unit cases cover quoted, single-quoted, odd-case and `=1` forms, and the trap-proxy CLI test now includes the quoted form. Bounded runner: quoted and odd-case runs exit 1 with 0 model, proxy and trap hits |
| Medium | `ps` sampling had no timeout, so it could outlive `--timeout-ms` | `execFile('ps', ..., { timeout: 2000 })`; Node kills only that child, and the sample reads as unavailable |
| Medium | The vitest wrapper's timeout killed the `node --test` runner but not the CLI children it spawned | The wrapper runs the suite directly with `killSignal: 'SIGTERM'`, and the suite kills only the CLI children it recorded. Child deadlines are now 6 s (request timeout 3 s) against a 90 s wrapper. Verified: a SIGTERM during the trap test made the suite exit 1, and its recorded child (PID 20619) was gone |
| Low | "A tool schema that can only fail" overclaimed, since `stop` and `list` do not go through `start_monitor` | The protocol now scopes the refusal to `start` |

Checks after the fixes: replay suite 10/10, both via `node --test` and run
directly. Capture `--check` is clean. Vitest is 264/264 across the baseline,
replay wrapper and related suites. `tsc -b` is clean, `git diff --check` is
clean, and `node --check` passes on both scripts.

## Not covered (real-model QA still open)

- No real local model was run. Real prompt tokens, TTFT, latency, peak
  memory, tool reliability and completion rate per
  `qa/unified-baseline-protocol.md` layers 1 and 2 are still to be measured on
  named hardware.
- RSS sampling on Windows (unsupported by design; the CLI warns), Linux, and
  the real `jan-llama-worker` process; IPv6 loopback against a real server; VRAM; the Local API proxy forwarding of
  `cache_prompt`.
- Remote providers (out of scope), migration, resume and rollback QA, and
  budgets.

<details><summary>Harness sources</summary>

`fake-server.mjs`

```js
// Controlled synthetic OpenAI-compatible SSE server for manual QA. Loopback only.
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
const [, , port, trapPort, log] = process.argv
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const rec = (o) => appendFileSync(log, JSON.stringify({ t: Date.now(), ...o }) + '\n')
createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const mode = req.url.split('/')[1]
    let body = {}
    try { body = JSON.parse(raw) } catch {}
    rec({ server: 'main', mode, method: req.method, url: req.url, host: req.headers.host,
      auth: req.headers.authorization ? 'present' : 'absent',
      model: body.model, stream: body.stream, temperature: body.temperature, max_tokens: body.max_tokens,
      cache_prompt: body.cache_prompt, stream_options: body.stream_options,
      messages: body.messages?.length, tools: body.tools?.length ?? 0, sampleKeys: Object.keys(body).sort() })
    if (mode === 'redirect') { res.writeHead(307, { location: `http://127.0.0.1:${trapPort}/v1/chat/completions` }); return res.end() }
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>proxy page</html>') }
    if (mode === 'err500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"synthetic failure"}') }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(sse({ choices: [{ delta: { role: 'assistant' } }] }))   // role-only: must NOT count as first token
    await wait(300)
    if (mode === 'tool') res.write(sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'read', arguments: '{"path":"a"}' } }] } }] }))
    else res.write(sse({ choices: [{ delta: { content: 'OK' } }] }))
    await wait(200)
    res.write(sse({ choices: [{ delta: {}, finish_reason: mode === 'tool' ? 'tool_calls' : 'stop' }] }))
    if (mode !== 'nousage') res.write(sse({ choices: [], usage: { prompt_tokens: 1000 + (body.tools?.length ?? 0), completion_tokens: 1 }, timings: { prompt_n: 1000, prompt_ms: 42.5, predicted_per_second: 10 } }))
    res.end('data: [DONE]\n\n')
  })
}).listen(Number(port), '127.0.0.1', () => rec({ server: 'main', listening: port }))
// Trap: any hit here means a redirect was followed.
createServer((req, res) => { rec({ server: 'TRAP', url: req.url }); res.writeHead(200); res.end() })
  .listen(Number(trapPort), '127.0.0.1', () => rec({ server: 'TRAP', listening: trapPort }))
```

`netlog.mjs`

```js
// Preload: log every outbound TCP socket and DNS lookup made by the CLI process.
import dc from 'node:diagnostics_channel'
import dns from 'node:dns'
import { appendFileSync } from 'node:fs'
const log = process.env.NETLOG
const w = (o) => appendFileSync(log, JSON.stringify({ pid: process.pid, ...o }) + '\n')
dc.subscribe('net.client.socket', ({ socket }) => socket.once('connect', () => w({ connect: `${socket.remoteAddress}:${socket.remotePort}` })))
const orig = dns.lookup
dns.lookup = function (host, ...rest) { w({ dnsLookup: host }); return orig.call(this, host, ...rest) }
```

`qa-run.mjs` (round 3, bounded)

```js
// Bounded manual QA for the replay CLI. All servers are in-process and closed in
// finally; each CLI run is a child with a hard deadline, and only that recorded
// child PID is killed on timeout. Synthetic loopback only; no real credentials.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
const repo = process.argv[2]
const hits = { model: 0, trap: 0, proxy: 0, stall: 0 }
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`
const model = createServer((req, res) => {
  req.resume(); hits.model++
  if (req.url.startsWith('/redirect')) { res.writeHead(307, { location: `http://127.0.0.1:${ports.trap}/v1/chat/completions` }); return res.end() }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(sse({ choices: [{ delta: { role: 'assistant' } }] }))
  setTimeout(() => res.end(sse({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }) +
    sse({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 1 } }) + 'data: [DONE]\n\n'), 100)
})
const trap = createServer((req, res) => { req.resume(); hits.trap++; res.end() })
const proxy = createServer((req, res) => { req.resume(); hits.proxy++; res.writeHead(502); res.end() })
proxy.on('connect', (_r, sock) => { hits.proxy++; sock.end('HTTP/1.1 502 trap\r\n\r\n') })
const stall = createServer((req, res) => {          // /headers: send headers + one chunk, then stall
  req.resume(); hits.stall++
  if (req.url.startsWith('/headers')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(sse({ choices: [{ delta: { content: 'O' } }] })) }
})
const servers = { model, trap, proxy, stall }, ports = {}
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)))
const cli = (args, env = {}, deadlineMs = 20000) => new Promise((resolve) => {
  const child = spawn(process.execPath, [`${repo}/scripts/unified-baseline-replay.mjs`, '--model', 'synthetic', '--runs', '1', '--warmup', '0', ...args],
    { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d))
  const t0 = Date.now()
  const timer = setTimeout(() => { out += ` [HARNESS DEADLINE: killed pid ${child.pid}]`; child.kill('SIGKILL') }, deadlineMs)
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, ms: Date.now() - t0, last: out.trim().split('\n').pop() }) })
})
const show = async (name, args, env) => {
  for (const k in hits) hits[k] = 0
  const r = await cli(args, env)
  console.log(`[${name}] exit=${r.code} ${r.ms}ms hits=${JSON.stringify(hits)} | ${r.last}`)
}
try {
  for (const [k, s] of Object.entries(servers)) ports[k] = await listen(s)
  const M = `http://127.0.0.1:${ports.model}/v1`, P = `http://127.0.0.1:${ports.proxy}`
  await show('direct, no proxy env', ['--base-url', M, '--scenarios', 'chat-bare'])
  for (const [n, env] of [
    ['NODE_USE_ENV_PROXY=1 HTTP_PROXY', { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: P }],
    ['NODE_USE_ENV_PROXY=1 http_proxy', { NODE_USE_ENV_PROXY: '1', http_proxy: P }],
    ['NODE_USE_ENV_PROXY=1 HTTPS_PROXY', { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: P }],
    ['NODE_USE_ENV_PROXY=1 https_proxy', { NODE_USE_ENV_PROXY: '1', https_proxy: P }],
    ['NODE_USE_ENV_PROXY=1 HTTP_PROXY + NO_PROXY=127.0.0.1', { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: P, NO_PROXY: '127.0.0.1' }],
    ['NODE_OPTIONS=--use-env-proxy http_proxy', { NODE_OPTIONS: '--use-env-proxy', http_proxy: P }],
    ['HTTP_PROXY without opt-in', { HTTP_PROXY: P }],
    ['NODE_USE_ENV_PROXY=1 without proxy var', { NODE_USE_ENV_PROXY: '1' }],
  ]) await show(n, ['--base-url', M, '--scenarios', 'chat-bare'], env)
  await show('--scenarios valid+typo', ['--base-url', M, '--scenarios', 'chat-bare,cowork-exec'])
  await show('--scenarios valid pair', ['--base-url', M, '--scenarios', 'chat-bare,cowork-plan'])
  await show('redirect to trap', ['--base-url', `http://127.0.0.1:${ports.model}/redirect/v1`, '--scenarios', 'chat-bare'])
  await show('server never answers, --timeout-ms 500', ['--base-url', `http://127.0.0.1:${ports.stall}/v1`, '--scenarios', 'chat-bare', '--timeout-ms', '500'])
  await show('stalls mid-stream, --timeout-ms 500', ['--base-url', `http://127.0.0.1:${ports.stall}/headers/v1`, '--scenarios', 'chat-bare', '--timeout-ms', '500'])
  await show('--timeout-ms 0', ['--base-url', M, '--timeout-ms', '0'])
} finally {
  for (const s of Object.values(servers)) { s.closeAllConnections(); s.close() }
}
```

</details>
