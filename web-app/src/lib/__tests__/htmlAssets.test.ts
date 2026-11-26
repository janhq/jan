import { describe, expect, it } from 'vitest'
import { countUnresolvedAssetRefs } from '../htmlAssets'

describe('countUnresolvedAssetRefs', () => {
  it('returns 0 for empty input', () => {
    expect(countUnresolvedAssetRefs('')).toBe(0)
  })

  it('ignores absolute http(s) refs', () => {
    const html = '<img src="https://cdn.example.com/logo.png"><a href="http://x.dev/page">x</a>'
    expect(countUnresolvedAssetRefs(html)).toBe(0)
  })

  it('ignores inline data and blob refs', () => {
    const html = '<img src="data:image/png;base64,AAAA"><link href="blob:abc123">'
    expect(countUnresolvedAssetRefs(html)).toBe(0)
  })

  it('ignores same-document anchors', () => {
    expect(countUnresolvedAssetRefs('<a href="#section">jump</a>')).toBe(0)
  })

  it('counts relative refs that cannot resolve in the sandbox', () => {
    const html = '<img src="./logo.png"><link href="style.css"><script src="app.js"></script>'
    expect(countUnresolvedAssetRefs(html)).toBe(3)
  })

  it('counts protocol-relative and root-absolute refs as unresolved', () => {
    const html = '<img src="//cdn.example.com/x.png"><script src="/vendor.js"></script>'
    expect(countUnresolvedAssetRefs(html)).toBe(2)
  })

  it('counts duplicates individually', () => {
    expect(countUnresolvedAssetRefs('<img src="a.png"><img src="a.png">')).toBe(2)
  })

  it('handles single and double quoted attributes', () => {
    const html = "<img src='a.png'><img src=\"b.png\">"
    expect(countUnresolvedAssetRefs(html)).toBe(2)
  })

  it('ignores empty attribute values', () => {
    expect(countUnresolvedAssetRefs('<img src=""><a href="">x</a>')).toBe(0)
  })
})
