import { describe, it, expect } from 'vitest'
import { validateManifest } from '@janhq/extension-api'
import { getBundledExtensions } from '../bundled-extensions'
import { HOST_BUILTINS, getHostBuiltins } from '@/lib/extensions/builtins'
import assistant from '../../../../../extensions/assistant-extension/package.json'
import download from '../../../../../extensions/download-extension/package.json'
import llamacpp from '../../../../../extensions/llamacpp-extension/package.json'
import mlx from '../../../../../extensions/mlx-extension/package.json'
import rag from '../../../../../extensions/rag-extension/package.json'
import vectorDb from '../../../../../extensions/vector-db-extension/package.json'

// vitest defines IS_MACOS as false, so mlx is not a host built-in here.
const LEGACY_PACKAGES = [rag, vectorDb]
const HOST_PACKAGES = [assistant, download, llamacpp]

const manifestFields = (m: {
  name: string
  productName?: string
  version?: string
  description?: string
}) => ({
  name: m.name,
  productName: m.productName,
  version: m.version,
  description: m.description,
})

describe('getBundledExtensions', () => {
  it('takes every entry name, productName, version and description from its package.json', async () => {
    const exts = await getBundledExtensions()
    expect(exts.map(manifestFields)).toEqual(
      LEGACY_PACKAGES.map(manifestFields)
    )
  })

  it('passes the package.json fields to the extension instance', async () => {
    const exts = await getBundledExtensions()
    for (const [i, ext] of exts.entries()) {
      expect(ext.extensionInstance?.name).toBe(LEGACY_PACKAGES[i].name)
      expect(ext.extensionInstance?.productName).toBe(
        LEGACY_PACKAGES[i].productName
      )
      expect(ext.extensionInstance?.version).toBe(LEGACY_PACKAGES[i].version)
      expect(ext.extensionInstance?.description).toBe(
        LEGACY_PACKAGES[i].description
      )
    }
  })

  // Threads and messages are host services now; every bundled extension
  // needs a native plugin, so mobile runs none of them.
  it('bundles no legacy extension on mobile', async () => {
    expect(await getBundledExtensions({ mobile: true })).toEqual([])
  })
})

describe('host built-ins', () => {
  it('never lists a package in both the host and the legacy list', async () => {
    const legacy = (await getBundledExtensions()).map((e) => e.name)
    const host = HOST_BUILTINS.map((b) => b.manifest.name)
    expect(host.filter((name) => legacy.includes(name))).toEqual([])
  })

  it('gives every host built-in the manifest its package.json validates to', () => {
    expect(HOST_BUILTINS.map((b) => b.manifest.name)).toEqual(
      HOST_PACKAGES.map((p) => p.name)
    )
    for (const [i, pkg] of HOST_PACKAGES.entries()) {
      const result = validateManifest(pkg)
      expect(result).toMatchObject({ ok: true })
      if (result.ok) expect(HOST_BUILTINS[i].manifest).toEqual(result.manifest)
    }
  })

  it('loads a module with activate for every host built-in', async () => {
    for (const b of HOST_BUILTINS) {
      const mod = await b.load()
      expect(typeof mod.activate).toBe('function')
    }
  })

  // mlx is a host built-in only on macOS; its manifest must still be valid.
  it('ships a valid manifest for the macOS-only mlx built-in', () => {
    expect(validateManifest(mlx)).toMatchObject({
      ok: true,
      manifest: { id: 'jan.mlx' },
    })
  })

  it('runs no host built-in on mobile', () => {
    expect(getHostBuiltins({ mobile: true })).toEqual([])
  })
})
