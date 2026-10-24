import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostedExtension } from '../host'

const files = vi.hoisted(() => ({ map: new Map<string, string>() }))
const host = vi.hoisted(() => ({
  list: vi.fn<() => HostedExtension[]>(() => []),
  spawnWorkerExtension: vi.fn(),
  unload: vi.fn(async () => undefined),
}))

vi.mock('@janhq/core', () => ({
  joinPath: async (parts: string[]) => parts.join('/'),
  fs: {
    readFileSync: async (path: string) => {
      const content = files.map.get(path)
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
  },
}))

vi.mock('../host', () => ({ getExtensionHost: () => host }))

import { DevLoadError, loadUnpacked, readUnpacked } from '../dev-loader'

const DIR = '/home/dev/hello'

const pkg = (jan: Record<string, unknown> = {}) => ({
  name: 'hello-provider',
  version: '0.1.0',
  jan: {
    id: 'acme.hello',
    displayName: 'Hello',
    publisher: 'Acme',
    apiVersion: '^1.0.0',
    main: 'dist/index.js',
    permissions: ['ui:notify'],
    ...jan,
  },
})

const BUNDLE = 'var JanExtension = { activate: function () {} }'

const writePkg = (value: unknown) =>
  files.map.set(`${DIR}/package.json`, JSON.stringify(value))

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DevLoadError)
  return error as DevLoadError
}

beforeEach(() => {
  files.map.clear()
  host.list.mockReturnValue([])
  host.spawnWorkerExtension.mockReset()
  host.unload.mockClear()
})

describe('readUnpacked', () => {
  it('reads the manifest and the jan.main bundle from the folder', async () => {
    writePkg(pkg())
    files.map.set(`${DIR}/dist/index.js`, 'var JanExtension = {}')
    const unpacked = await readUnpacked(DIR)
    expect(unpacked.manifest).toMatchObject({ id: 'acme.hello', version: '0.1.0' })
    expect(unpacked.bundle).toBe('var JanExtension = {}')
  })

  it('accepts a ./ prefix and a trailing separator on the folder', async () => {
    writePkg(pkg({ main: './dist/index.js' }))
    files.map.set(`${DIR}/dist/index.js`, BUNDLE)
    await expect(readUnpacked(`${DIR}/`)).resolves.toMatchObject({ bundle: BUNDLE })
  })

  it('reports a missing package.json', async () => {
    const error = await codeOf(readUnpacked(DIR))
    expect(error.code).toBe('readFailed')
    expect(error.params.file).toBe('package.json')
  })

  it('reports package.json that is not JSON', async () => {
    files.map.set(`${DIR}/package.json`, '{ nope')
    expect((await codeOf(readUnpacked(DIR))).code).toBe('invalidJson')
  })

  it('reports every manifest error', async () => {
    writePkg(pkg({ id: 'Bad Id', permissions: ['fs:all'] }))
    const error = await codeOf(readUnpacked(DIR))
    expect(error.code).toBe('invalidManifest')
    expect(error.params.errors).toContain('jan.id')
    expect(error.params.errors).toContain('jan.permissions[0]')
  })

  it.each(['../outside.js', '/etc/passwd.js', 'dist/../../x.js', 'C:\\x.js'])(
    'rejects a main path that escapes the folder: %s',
    async (main) => {
      writePkg(pkg({ main }))
      const error = await codeOf(readUnpacked(DIR))
      expect(error.code).toBe('invalidManifest')
      expect(error.params.errors).toContain('jan.main')
    }
  )

  it('refuses a bundle that is not a single var JanExtension (hoisted declarations)', async () => {
    writePkg(pkg())
    files.map.set(
      `${DIR}/dist/index.js`,
      `function Set() { self.__net = fetch }\n${BUNDLE}`
    )
    const error = await codeOf(readUnpacked(DIR))
    expect(error.code).toBe('invalidBundle')
    expect(error.params).toMatchObject({
      file: 'dist/index.js',
      error: expect.stringContaining('JanExtension'),
    })
  })

  it('reports a missing bundle', async () => {
    writePkg(pkg())
    const error = await codeOf(readUnpacked(DIR))
    expect(error.code).toBe('readFailed')
    expect(error.params.file).toBe('dist/index.js')
  })
})

describe('loadUnpacked', () => {
  const hosted = (
    source: HostedExtension['source'],
    state: HostedExtension['state']
  ): HostedExtension =>
    ({ id: 'acme.hello', source, state }) as HostedExtension

  it('spawns a dev worker granted everything the manifest requests', async () => {
    writePkg(pkg({ permissions: ['ui:notify', 'network:api.example.com'] }))
    files.map.set(`${DIR}/dist/index.js`, BUNDLE)
    const unpacked = await readUnpacked(DIR)
    host.spawnWorkerExtension.mockResolvedValue(hosted('dev', 'active'))

    await expect(loadUnpacked(unpacked)).resolves.toMatchObject({ state: 'active' })
    expect(host.spawnWorkerExtension).toHaveBeenCalledWith({
      manifest: unpacked.manifest,
      bundle: BUNDLE,
      grants: ['ui:notify', 'network:api.example.com'],
      source: 'dev',
    })
  })

  it('refuses an id that is already running', async () => {
    writePkg(pkg())
    files.map.set(`${DIR}/dist/index.js`, BUNDLE)
    const unpacked = await readUnpacked(DIR)
    host.list.mockReturnValue([hosted('builtin', 'failed')])
    expect((await codeOf(loadUnpacked(unpacked))).code).toBe('alreadyLoaded')
    host.list.mockReturnValue([hosted('dev', 'active')])
    expect((await codeOf(loadUnpacked(unpacked))).code).toBe('alreadyLoaded')
    expect(host.spawnWorkerExtension).not.toHaveBeenCalled()
  })

  it('replaces a dev load that failed, so a fixed folder can be retried', async () => {
    writePkg(pkg())
    files.map.set(`${DIR}/dist/index.js`, BUNDLE)
    const unpacked = await readUnpacked(DIR)
    host.list.mockReturnValue([hosted('dev', 'failed')])
    host.spawnWorkerExtension.mockResolvedValue(hosted('dev', 'active'))
    await loadUnpacked(unpacked)
    expect(host.unload).toHaveBeenCalledWith('acme.hello')
    expect(host.spawnWorkerExtension).toHaveBeenCalled()
  })
})
