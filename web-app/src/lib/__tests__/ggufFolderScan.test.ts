import { describe, it, expect, vi } from 'vitest'

/**
 * Reference recursive walk (mirrors folder-import rules: .gguf, exclude mmproj).
 * Used to validate mocked `readdirSync` / `fileStat` layouts when hosts return
 * bare filenames or full paths. Production scanning uses `get_gguf_files` / `fs.getGgufFiles`.
 */
function joinDirEntry(dirPath: string, entry: string): string {
  if (entry.includes('/') || entry.includes('\\')) {
    return entry
  }
  const trim = dirPath.replace(/[/\\]$/, '')
  const sep = dirPath.includes('\\') ? '\\' : '/'
  return `${trim}${sep}${entry}`
}

async function listGgufFilesFromDirectory(
  dirPath: string,
  fsApi: {
    readdirSync: (p: string) => Promise<string[]>
    fileStat: (p: string) => Promise<{ isDirectory?: boolean } | undefined>
  }
): Promise<string[]> {
  const files: string[] = []
  const entries = await fsApi.readdirSync(dirPath)
  for (const entry of entries) {
    const fullPath = joinDirEntry(dirPath, entry)
    const stat = await fsApi.fileStat(fullPath)
    if (stat?.isDirectory) {
      files.push(...(await listGgufFilesFromDirectory(fullPath, fsApi)))
      continue
    }
    const lower = fullPath.toLowerCase()
    if (lower.endsWith('.gguf') && !lower.includes('mmproj')) {
      files.push(fullPath)
    }
  }
  return files
}

describe('listGgufFilesFromDirectory (reference walk with mocked fs)', () => {
  it('recurses into subdirs and collects gguf paths when readdir returns basenames', async () => {
    const fsApi = {
      readdirSync: vi.fn(async (dir: string) => {
        if (dir === '/root') {
          return ['sub', 'a.gguf']
        }
        if (dir === '/root/sub') {
          return ['b.gguf']
        }
        return []
      }),
      fileStat: vi.fn(async (p: string) => {
        if (p === '/root/sub') {
          return { isDirectory: true }
        }
        return { isDirectory: false }
      }),
    }

    const result = await listGgufFilesFromDirectory('/root', fsApi)
    expect(result.sort()).toEqual(['/root/a.gguf', '/root/sub/b.gguf'])
  })

  it('excludes mmproj gguf files', async () => {
    const fsApi = {
      readdirSync: vi.fn(async () => ['ok.gguf', 'vision-mmproj.gguf']),
      fileStat: vi.fn(async () => ({ isDirectory: false })),
    }

    const result = await listGgufFilesFromDirectory('/m', fsApi)
    expect(result).toEqual(['/m/ok.gguf'])
  })

  it('works when readdir returns full paths (host-native)', async () => {
    const fsApi = {
      readdirSync: vi.fn(async () => ['/m/nested/c.gguf']),
      fileStat: vi.fn(async () => ({ isDirectory: false })),
    }

    const result = await listGgufFilesFromDirectory('/m', fsApi)
    expect(result).toEqual(['/m/nested/c.gguf'])
  })
})
