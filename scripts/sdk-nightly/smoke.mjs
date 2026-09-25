// Run from a clean npm project, not from the SDK source tree.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { JanRuntime, installRuntime } from '@janhq/agent-sdk'

const installed = await installRuntime({
  manifestUrl: process.env.RUNTIME_MANIFEST,
  version: process.env.RUNTIME_VERSION,
})
execFileSync(installed.bin, ['config', 'set', '--provider', 'stub', '--api-key', 'smoke',
  '--base-url', process.env.PROVIDER_URL, '--model', 'stub-model'])
let calls = 0
const runtime = await JanRuntime.start({ bin: installed.bin })
const pid = runtime.pid
try {
  const session = await runtime.createSession({
    model: 'stub-model', ephemeral: true, builtins: false,
    tools: [{
      name: 'measure', description: 'Read the sensor.', capability: 'read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => { calls++; return { text: 'sensor=42' } },
    }],
  })
  const turn = await session.prompt('Read the sensor.')
  let text = ''
  for await (const event of turn) if (event.type === 'token') text += event.text
  assert.equal((await turn.result()).stopReason, 'completed')
  assert.equal(text, 'The sensor is 42.')
  assert.equal(calls, 1)
} finally {
  await runtime.close()
}
assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
console.log('JavaScript: installed artifact -> pinned runtime -> host callback -> streamed result -> reaped process')
