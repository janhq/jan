// Give Jan Agent a tool that your Node.js code executes.
//
// Declares `get_weather` with `--host-tools`, checks the run advertised it,
// approves the permission prompt for it (the run is started with `--safe`, so
// your code decides every side effect), runs it when the model calls it, and
// sends the result back. Everything travels over the stream-json channel of
// `jan cli agent run`. No dependencies.
//
//     node host-tool.mjs "What's the weather in Hanoi?"
//
// Set JAN_BIN to use a jan binary that is not on PATH, and JAN_MODEL to pick a model.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const jan = process.env.JAN_BIN ?? 'jan'
const task = process.argv[2] ?? "What's the weather in Hanoi? Use the get_weather tool."

// What the model sees, as `host__get_weather`. Jan validates the declaration
// before the run starts; the arguments are validated by your code, below.
const tools = [
  {
    name: 'get_weather',
    description: 'Current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
]

const handlers = {
  get_weather({ city }) {
    if (typeof city !== 'string') throw new Error("'city' must be a string")
    return { city, forecast: 'sunny', celsius: 21 }
  },
}

const scratch = mkdtempSync(join(tmpdir(), 'jan-host-tool-'))
const project = join(scratch, 'project')
mkdirSync(project)
const toolsFile = join(scratch, 'host-tools.json')
writeFileSync(toolsFile, JSON.stringify(tools))

const args = [
  'cli', 'agent', 'run',
  '--project', project,
  '--safe',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--host-tools', toolsFile,
]
if (process.env.JAN_MODEL) args.push('--model', process.env.JAN_MODEL)
args.push(task)

const run = spawn(jan, args, { stdio: ['pipe', 'pipe', 'inherit'] })
const exited = new Promise((resolve) => run.on('close', resolve))
const send = (message) => run.stdin.write(JSON.stringify(message) + '\n')

let result = null
for await (const line of createInterface({ input: run.stdout })) {
  const record = JSON.parse(line)
  switch (record.type) {
    case 'init': {
      // A declared tool missing here was withheld by policy (deny list, plan
      // mode) and will never be called.
      const advertised = new Set((record.tool_specs ?? []).map((spec) => spec.function.name))
      const missing = tools.map((t) => `host__${t.name}`).filter((name) => !advertised.has(name))
      if (missing.length) console.error(`withheld by policy: ${missing.join(', ')}`)
      break
    }
    case 'permission_request':
      // Under `--safe` a host tool is prompted like an MCP tool, and so are
      // writes and shell commands. Approve ours; refuse the rest.
      send({
        type: 'permission',
        request_id: record.request_id,
        decision: record.tool_name.startsWith('host__') ? 'allow_once' : 'deny',
      })
      break
    case 'tool_request': {
      // `tool_name` is the name declared above, without `host__`.
      let content
      let isError = false
      try {
        const handler = handlers[record.tool_name]
        if (!handler) throw new Error(`no handler for ${record.tool_name}`)
        content = JSON.stringify(handler(record.args))
      } catch (error) {
        // The model sees this as the tool's error.
        content = `${error.name}: ${error.message}`
        isError = true
      }
      console.error(`\n[${record.tool_name}(${JSON.stringify(record.args)}) -> ${content}]`)
      send({ type: 'tool_result', request_id: record.request_id, content, is_error: isError })
      break
    }
    case 'token':
      process.stdout.write(record.text)
      break
    case 'result':
      result = record
      break
  }
}
run.stdin.end()
const code = await exited
rmSync(scratch, { recursive: true, force: true })

console.log()
if (result === null) {
  console.error(`jan exited with ${code} before printing a result`)
  process.exit(1)
}
if (result.is_error) {
  console.error(`run failed: ${result.error.code}: ${result.error.message}`)
  process.exit(1)
}
