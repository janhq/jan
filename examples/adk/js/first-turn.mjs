// Run one Jan Agent task from Node.js and stream the answer.
//
// Starts `jan cli agent run` with `--output-format stream-json`, prints the
// answer as it streams, and reads the terminal `result` record. No dependencies.
//
//     node first-turn.mjs "Explain what a mutex is in one sentence."
//
// Set JAN_BIN to use a jan binary that is not on PATH, and JAN_MODEL to pick a model.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const jan = process.env.JAN_BIN ?? 'jan'
const task = process.argv[2] ?? 'Reply with one short sentence: what is Jan Agent?'

// A fresh, empty project: the agent's own file and shell tools are confined to
// it, so an example cannot touch the directory you ran it from.
const project = mkdtempSync(join(tmpdir(), 'jan-first-turn-'))
const args = ['cli', 'agent', 'run', '--project', project, '--output-format', 'stream-json']
if (process.env.JAN_MODEL) args.push('--model', process.env.JAN_MODEL)
args.push(task)

const run = spawn(jan, args, { stdio: ['ignore', 'pipe', 'inherit'] })
const exited = new Promise((resolve) => run.on('close', resolve))

let result = null
for await (const line of createInterface({ input: run.stdout })) {
  const record = JSON.parse(line)
  if (record.type === 'init') {
    console.error(`[session ${record.session_id} on ${record.model}]`)
  } else if (record.type === 'token') {
    process.stdout.write(record.text)
  } else if (record.type === 'result') {
    result = record
  }
}
const code = await exited
rmSync(project, { recursive: true, force: true })

console.log()
if (result === null) {
  console.error(`jan exited with ${code} before printing a result`)
  process.exit(1)
}
if (result.is_error) {
  console.error(`run failed: ${result.error.code}: ${result.error.message}`)
  process.exit(1)
}
console.error(`[${result.stop_reason} after ${result.num_turns} turn(s)]`)
