import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertFixture, assertMigrated, historicalThread, migrationPhases, seedMigration, selectScenario } from '../migration.js'
import { janUserDataDir } from '../helpers/paths.js'

test('scenario selection is strict and defaults only when absent', () => {
  assert.equal(selectScenario(), 'default')
  assert.equal(selectScenario('migration'), 'migration')
  for (const value of ['', 'Migration', 'chat', ' migration']) assert.throws(() => selectScenario(value))
})

test('authentic fixture starts at schema 3; expected migration preserves every other field', () => {
  assertFixture()
  const home = mkdtempSync(join(tmpdir(), 'jan-migration-unit-'))
  try {
    seedMigration(home)
    const data = janUserDataDir(home)
    assert.throws(() => assertMigrated(home))
    const store = join(data, 'store.json')
    writeFileSync(store, JSON.stringify({ ...JSON.parse(readFileSync(store, 'utf8')), mcp_version: 5 }))
    assert.throws(() => assertMigrated(home)) // schema alone is not enough
    const config = join(data, 'mcp_config.json')
    const mcp = JSON.parse(readFileSync(config, 'utf8'))
    delete mcp.mcpServers.exa
    writeFileSync(config, JSON.stringify(mcp))
    assertMigrated(home)
    const messages = join(data, 'threads', historicalThread, 'messages.jsonl')
    const original = readFileSync(messages, 'utf8')
    writeFileSync(messages, original.replace('confirm mock roundtrip', 'lost history'))
    assert.throws(() => assertMigrated(home))
    writeFileSync(messages, original)
    delete mcp.mcpServers.fetch
    writeFileSync(config, JSON.stringify(mcp))
    assert.throws(() => assertMigrated(home))
    writeFileSync(config, JSON.stringify({ ...mcp, mcpServers: { ...mcp.mcpServers, fetch: { active: false } } }))
    assert.throws(() => assertMigrated(home)) // retaining only a server name is not enough
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('two separate launches have a port-closure barrier before, between and after', async () => {
  const events: string[] = []
  await migrationPhases(async phase => { events.push(`launch ${phase}`) }, async () => { events.push('closed') })
  assert.deepEqual(events, ['closed', 'launch 1', 'closed', 'launch 2', 'closed'])
})

test('failed first launch or closure barrier never launches phase two', async () => {
  for (const failLaunch of [true, false]) {
    const launches: number[] = []
    let barriers = 0
    await assert.rejects(migrationPhases(async phase => {
      launches.push(phase)
      if (failLaunch) throw new Error('launch failed')
    }, async () => {
      if (++barriers === 2) throw new Error('port still open')
    }))
    assert.deepEqual(launches, [1])
  }
})
