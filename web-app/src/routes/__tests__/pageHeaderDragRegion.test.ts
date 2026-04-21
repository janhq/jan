import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const routeFiles = [
  {
    file: 'hub/index.tsx',
    forbiddenClass: "'pr-3 py-3 h-10 w-full flex items-center justify-between relative z-20'",
  },
  {
    file: 'marketplace/index.tsx',
    forbiddenClass:
      "'pr-3 py-3 min-h-10 w-full flex items-center justify-between relative z-20 flex-wrap gap-y-2'",
  },
  {
    file: 'local-models/index.tsx',
    forbiddenClass: "'pr-3 py-3 h-10 w-full flex items-center justify-between relative z-20'",
  },
  {
    file: 'openclaw/index.tsx',
    forbiddenClass: "'pr-3 py-3 h-10 w-full flex items-center justify-between relative z-20'",
  },
]

describe('page header drag region regression', () => {
  it('does not elevate the full header wrapper above the global drag layer', () => {
    const offenders = routeFiles.filter(({ file, forbiddenClass }) => {
      const source = readFileSync(resolve(currentDir, '..', file), 'utf8')
      return source.includes(forbiddenClass)
    })

    expect(offenders.map(({ file }) => file)).toEqual([])
  })
})
