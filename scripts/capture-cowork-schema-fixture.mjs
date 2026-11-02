// Deliberately narrow source capture, not a Rust parser. Unknown expressions
// fail JSON.parse rather than silently approximating a model-facing schema.
//
//   node scripts/capture-cowork-schema-fixture.mjs           # regenerate
//   node scripts/capture-cowork-schema-fixture.mjs --check   # fail on drift
//
// The same comparison runs in web-app's unifiedBaseline vitest, so CI catches
// both schema.rs changes and hand edits to the fixture.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SOURCE_PATH = 'src-tauri/plugins/tauri-plugin-agent-tools/src/tools/schema.rs'
export const FIXTURE_PATH = 'qa/fixtures/unified-baseline/builtin-schemas.json'
const root = new URL('../', import.meta.url)

/** A Windows checkout with core.autocrlf rewrites LF to CRLF; that is not drift. */
export const normalizeEol = (text) => text.replace(/\r\n/g, '\n')

/** The fixture text schema.rs should produce, from LF-normalized source. */
export function captureFixture(rawSource) {
  const source = normalizeEol(rawSource)
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
    sourcePath: SOURCE_PATH,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    assumptions: 'Desktop tauri feature, POSIX shell, no escalation. Raw builtins before agentTools filtering; no IPC or execution.',
    schemas,
  }
  return JSON.stringify(fixture, null, 2) + '\n'
}

function main() {
  const serialized = captureFixture(readFileSync(new URL(SOURCE_PATH, root), 'utf8'))
  const target = new URL(FIXTURE_PATH, root)
  if (process.argv.includes('--check')) {
    assert.equal(normalizeEol(readFileSync(target, 'utf8')), serialized,
      'Schema fixture drift: review source, regenerate, and review request-shape snapshot')
  } else {
    writeFileSync(target, serialized)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
