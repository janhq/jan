import { describe, it, expect } from 'vitest'
import { getBundledExtensions } from '../bundled-extensions'
import assistant from '../../../../../extensions/assistant-extension/package.json'
import conversational from '../../../../../extensions/conversational-extension/package.json'
import download from '../../../../../extensions/download-extension/package.json'
import llamacpp from '../../../../../extensions/llamacpp-extension/package.json'
import rag from '../../../../../extensions/rag-extension/package.json'
import vectorDb from '../../../../../extensions/vector-db-extension/package.json'

// vitest defines IS_MACOS as false, so mlx is not bundled here.
const PACKAGES = [assistant, conversational, download, llamacpp, rag, vectorDb]

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
    expect(exts.map(manifestFields)).toEqual(PACKAGES.map(manifestFields))
  })

  it('passes the package.json fields to the extension instance', async () => {
    const exts = await getBundledExtensions()
    for (const [i, ext] of exts.entries()) {
      expect(ext.extensionInstance?.name).toBe(PACKAGES[i].name)
      expect(ext.extensionInstance?.productName).toBe(PACKAGES[i].productName)
      expect(ext.extensionInstance?.version).toBe(PACKAGES[i].version)
      expect(ext.extensionInstance?.description).toBe(PACKAGES[i].description)
    }
  })

  it('bundles only Conversational on mobile', async () => {
    const exts = await getBundledExtensions({ mobile: true })
    expect(exts.map(manifestFields)).toEqual([manifestFields(conversational)])
  })
})
