// Deliberately narrow source capture, not a Rust parser. Unknown expressions
// fail JSON.parse rather than silently approximating a model-facing schema.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const sourcePath = 'src-tauri/plugins/tauri-plugin-agent-tools/src/tools/schema.rs'
const source = readFileSync(new URL(sourcePath, root), 'utf8')
const constant = (name) => {
  const match = source.match(new RegExp(`const ${name}: &str = ("[^\\n]*");`))
  assert.ok(match, `Missing ${name}; review fixture capture`)
  return JSON.parse(match[1])
}
const body = source.split('pub fn builtin_tool_schemas() -> Vec<Value> {')[1]
  ?.split('    .to_vec()')[0]
assert.ok(body, 'Builtin schema function changed; review capture')
const schemas = [...body.matchAll(/json!\((\{[\s\S]*?\})\),/g)].map((match) =>
  JSON.parse(match[1]
    .replaceAll('super::SHELL_TOOL', '"shell"')
    .replaceAll('super::MEMORY_TOOL', '"memory"')
    .replaceAll('bash_description(super::proc::shell().kind)', JSON.stringify(constant('BASH_DESCRIPTION')))
    .replaceAll('MEMORY_DESCRIPTION', JSON.stringify(constant('MEMORY_DESCRIPTION'))))
)
assert.equal(schemas.length, (body.match(/json!\(/g) ?? []).length,
  'Uncaptured macro; review capture')
assert.ok(schemas.length > 0)
const fixture = {
  sourcePath,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  assumptions: 'Desktop tauri feature, POSIX shell, no escalation. Raw builtins before agentTools filtering; no IPC or execution.',
  schemas,
}
const serialized = JSON.stringify(fixture, null, 2) + '\n'
const target = new URL('qa/fixtures/unified-baseline/builtin-schemas.json', root)
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(target, 'utf8'), serialized,
    'Schema fixture drift: review source, regenerate, and review request-shape snapshot')
} else {
  writeFileSync(target, serialized)
}
