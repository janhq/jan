import { describe, it, expect } from 'vitest'
import {
  tokenize,
  classifyIntent,
  ROUTING_THRESHOLD,
  MAX_ROUTED_SERVERS,
} from '../intent-classifier'
import type { ServerSummary } from '@/services/mcp/types'

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric separators', () => {
    expect(tokenize('Read a File from Disk')).toContain('read')
    expect(tokenize('Read a File from Disk')).toContain('file')
    expect(tokenize('Read a File from Disk')).toContain('disk')
  })

  it('strips stop words', () => {
    const tokens = tokenize('a the and or is are')
    expect(tokens).toHaveLength(0)
  })

  it('removes single-character tokens', () => {
    const tokens = tokenize('x y z hello')
    expect(tokens).not.toContain('x')
    expect(tokens).not.toContain('y')
    expect(tokens).toContain('hello')
  })

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('handles punctuation and special chars', () => {
    const tokens = tokenize('read/write the file_path.txt')
    expect(tokens).toContain('read')
    expect(tokens).toContain('write')
    expect(tokens).toContain('file')
    expect(tokens).toContain('path')
    expect(tokens).toContain('txt')
  })
})

// ---------------------------------------------------------------------------
// classifyIntent — small server set (no routing needed)
// ---------------------------------------------------------------------------

describe('classifyIntent — below threshold', () => {
  const servers: ServerSummary[] = [
    { name: 'fs', capabilities: ['filesystem'], description: 'file operations' },
    { name: 'web', capabilities: ['web', 'browser'], description: 'browse the web' },
    { name: 'db', capabilities: ['database'], description: 'query databases' },
  ]

  it('returns all servers when count ≤ threshold', () => {
    // servers.length (3) ≤ ROUTING_THRESHOLD (5)
    const result = classifyIntent('read a file', servers)
    expect(result).toHaveLength(servers.length)
    expect(result).toContain('fs')
    expect(result).toContain('web')
    expect(result).toContain('db')
  })
})

// ---------------------------------------------------------------------------
// classifyIntent — routing active (> threshold servers)
// ---------------------------------------------------------------------------

const manyServers: ServerSummary[] = [
  { name: 'filesystem', capabilities: ['filesystem', 'files'], description: 'read and write files on disk' },
  { name: 'browser', capabilities: ['web', 'browser', 'search'], description: 'browse web pages and search' },
  { name: 'database', capabilities: ['database', 'sql'], description: 'query relational databases' },
  { name: 'calendar', capabilities: ['calendar', 'events', 'schedule'], description: 'manage calendar events' },
  { name: 'email', capabilities: ['email', 'mail'], description: 'send and read emails' },
  { name: 'code', capabilities: ['code', 'git', 'github'], description: 'interact with code repositories' },
]

describe('classifyIntent — above threshold', () => {
  it('returns only relevant servers for a filesystem query', () => {
    const result = classifyIntent('read the config file from disk', manyServers)
    expect(result).toContain('filesystem')
    expect(result).not.toContain('calendar')
    expect(result).not.toContain('email')
  })

  it('returns only relevant servers for a web query', () => {
    const result = classifyIntent('search the web for news', manyServers)
    expect(result).toContain('browser')
    expect(result).not.toContain('filesystem')
    expect(result).not.toContain('calendar')
  })

  it('returns only relevant servers for a code query', () => {
    const result = classifyIntent('show me git commits on github', manyServers)
    expect(result).toContain('code')
  })

  it('returns all servers when no keywords match (safe fallback)', () => {
    const result = classifyIntent('zxqfoo bar baz', manyServers)
    expect(result).toHaveLength(manyServers.length)
  })

  it('returns all servers for an empty message', () => {
    const result = classifyIntent('', manyServers)
    expect(result).toHaveLength(manyServers.length)
  })

  it('respects maxServers option', () => {
    // Craft a message that matches all servers
    const wideMessage = 'files web database calendar email code git'
    const result = classifyIntent(wideMessage, manyServers, { maxServers: 2 })
    expect(result.length).toBeLessThanOrEqual(2)
  })

  it('returns empty array for empty server list', () => {
    expect(classifyIntent('read a file', [])).toEqual([])
  })

  it('does not exceed MAX_ROUTED_SERVERS by default', () => {
    const lotsOfServers: ServerSummary[] = Array.from({ length: 20 }, (_, i) => ({
      name: `server${i}`,
      capabilities: ['generic'],
      description: 'generic server',
    }))
    const wideMessage = 'do something generic with all servers'
    const result = classifyIntent(wideMessage, lotsOfServers)
    expect(result.length).toBeLessThanOrEqual(MAX_ROUTED_SERVERS)
  })
})

// ---------------------------------------------------------------------------
// classifyIntent — exact vs partial capability matches
// ---------------------------------------------------------------------------

describe('classifyIntent — scoring weights', () => {
  const servers: ServerSummary[] = [
    { name: 'exact', capabilities: ['email'], description: 'email server' },
    { name: 'partial', capabilities: ['emailing'], description: 'handles emailing tasks' },
    { name: 'desc', capabilities: ['messaging'], description: 'send email notifications' },
    { name: 'unrelated', capabilities: ['filesystem'], description: 'read local files' },
    { name: 'unrelated2', capabilities: ['calendar'], description: 'manage events' },
    { name: 'unrelated3', capabilities: ['database'], description: 'sql queries' },
  ]

  it('prefers exact capability match over description match', () => {
    const result = classifyIntent('send an email', servers)
    const exactIdx = result.indexOf('exact')
    const descIdx = result.indexOf('desc')

    expect(exactIdx).toBeGreaterThanOrEqual(0)
    // exact match should score higher (appear earlier) than desc-only match
    if (descIdx !== -1) {
      expect(exactIdx).toBeLessThanOrEqual(descIdx)
    }
  })
})
