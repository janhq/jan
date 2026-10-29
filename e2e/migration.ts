import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { janUserDataDir } from './helpers/paths.js'

export const fixtureDir = join(import.meta.dirname, '../src-tauri/tests/fixtures/upgrade/0.8.3')
export const historicalThread = '784952d3-dc72-474e-ab24-0d78e7035280'
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

export function assertFixture(source = fixtureDir) {
  assert.equal(json(join(source, 'store.json')).mcp_version, 3)
  assert.ok(json(join(source, 'mcp_config.json')).mcpServers.exa, 'fixture must carry Exa')
  assert.ok(readdirSync(join(source, 'threads')).includes(historicalThread))
}

/** Only called on the runner's own freshly-created, guarded profile. */
export function seedMigration(home: string, source = fixtureDir) {
  assertFixture(source)
  const destination = janUserDataDir(home)
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false })
}

/** Compare all fixture thread IDs, metadata, message IDs and content, not just counts. */
export function assertMigrated(home: string, source = fixtureDir) {
  const destination = janUserDataDir(home)
  assert.equal(json(join(destination, 'store.json')).mcp_version, 5)
  const expected = json(join(source, 'mcp_config.json'))
  delete expected.mcpServers.exa
  assert.deepEqual(json(join(destination, 'mcp_config.json')), expected)
  const ids = readdirSync(join(source, 'threads')).sort()
  assert.deepEqual(readdirSync(join(destination, 'threads')).sort(), ids)
  for (const id of ids) {
    assert.deepEqual(json(join(destination, 'threads', id, 'thread.json')),
      json(join(source, 'threads', id, 'thread.json')))
    const messages = (root: string) => readFileSync(join(root, 'threads', id, 'messages.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(messages(destination), messages(source))
  }
}

export function selectScenario(value = 'default'): 'default' | 'migration' {
  if (value !== 'default' && value !== 'migration') {
    throw new Error(`Invalid JAN_E2E_SCENARIO ${JSON.stringify(value)}: expected default or migration`)
  }
  return value
}

/** The second launch must never seed, even when the first launch fails. */
export async function migrationPhases(launch: (phase: number) => Promise<void>, closed: () => Promise<void>) {
  await closed()
  for (const phase of [1, 2]) {
    await launch(phase)
    await closed()
  }
}
