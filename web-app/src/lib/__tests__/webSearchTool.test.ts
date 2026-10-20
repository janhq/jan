import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  webFetch: vi.fn(),
  mcp: {
    settings: { maxToolOutputChars: 40000 } as { maxToolOutputChars?: number },
  },
}))

vi.mock('@janhq/tauri-plugin-websearch-api', () => ({
  webSearch: vi.fn(),
  webFetch: h.webFetch,
}))
vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: {
    getState: () => ({ apiKeys: {}, endpoints: {}, searchProvider: 'default' }),
  },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: { getState: () => h.mcp },
}))

import { executeWebTool, webOutputCap } from '../webSearchTool'
import { parseWebFetchOutput } from '../toolPresentation'

const page = (content: string, truncated = false) => ({
  title: 'Trending',
  url: 'https://github.com/trending',
  content,
  truncated,
})
const fetchText = async (maxOutputChars?: number) => {
  const out = await executeWebTool(
    'web_fetch',
    { url: 'https://github.com/trending' },
    { maxOutputChars }
  )
  return out.content as string
}

beforeEach(() => {
  h.webFetch.mockReset()
  h.mcp.settings = { maxToolOutputChars: 40000 }
})

describe('web_fetch output is held to the same budget as an MCP result', () => {
  // The page a 4,096-token window cannot hold (#9170).
  it('is cut to the budget the model window affords', async () => {
    h.webFetch.mockResolvedValue(page('x'.repeat(39000)))

    const text = await fetchText(3600)

    expect(text.length).toBeLessThanOrEqual(3600)
    const parsed = parseWebFetchOutput(text)!
    expect(parsed.title).toBe('Trending')
    expect(parsed.url).toBe('https://github.com/trending')
    expect(parsed.truncated).toBe(true)
    expect(parsed.content.length).toBeGreaterThan(3000)
  })

  it('is cut to the "Max tool output characters" setting, which it used to ignore', async () => {
    h.mcp.settings = { maxToolOutputChars: 10000 }
    h.webFetch.mockResolvedValue(page('x'.repeat(28749)))

    const text = await fetchText()

    expect(text.length).toBeLessThanOrEqual(10000)
    expect(parseWebFetchOutput(text)!.truncated).toBe(true)
  })

  it('follows the tighter of the two', async () => {
    h.mcp.settings = { maxToolOutputChars: 5000 }
    h.webFetch.mockResolvedValue(page('x'.repeat(20000)))

    expect((await fetchText(3600)).length).toBeLessThanOrEqual(3600)
    expect((await fetchText(30000)).length).toBeLessThanOrEqual(5000)
  })

  it('keeps a page that fits, with no marker', async () => {
    h.webFetch.mockResolvedValue(page('short page'))

    const text = await fetchText(3600)

    expect(text).toBe(
      'Title: Trending\nURL: https://github.com/trending\n\nshort page'
    )
  })

  it('marks a page the plugin already cut exactly once, and stays within the budget', async () => {
    h.webFetch.mockResolvedValue(page('x'.repeat(3590), true))

    const text = await fetchText(3600)

    expect(text.length).toBeLessThanOrEqual(3600)
    expect(text.match(/\[content truncated\]/g)).toHaveLength(1)
  })

  it('leaves the page whole when the setting is 0, as the setting promises', async () => {
    h.mcp.settings = { maxToolOutputChars: 0 }
    h.webFetch.mockResolvedValue(page('x'.repeat(39000)))

    const parsed = parseWebFetchOutput(await fetchText(3600))!

    expect(parsed.content).toHaveLength(39000)
    expect(parsed.truncated).toBe(false)
  })

  it('does not split a character that takes two code units', async () => {
    h.webFetch.mockResolvedValue(page('😀'.repeat(5000)))

    const text = await fetchText(1000)

    const body = parseWebFetchOutput(text)!.content
    expect(body.length).toBeGreaterThan(0)
    // A lone high surrogate at the end would be a broken character.
    const last = body.charCodeAt(body.length - 1)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
  })

  // The header comes from the page too (#9283): a title of 20,000 characters
  // must not put the output past the budget on its own.
  it('holds an oversized title and url to the budget as well', async () => {
    h.webFetch.mockResolvedValue({
      title: 'T'.repeat(20000),
      url: `https://example.com/${'u'.repeat(20000)}`,
      content: 'x'.repeat(5000),
      truncated: false,
    })

    const text = await fetchText(3600)

    expect(text.length).toBeLessThanOrEqual(3600)
    const parsed = parseWebFetchOutput(text)!
    expect(parsed.title!.length).toBeLessThanOrEqual(900)
    // The page still gets the rest of the budget, and the result says it was cut.
    expect(parsed.content.length).toBeGreaterThan(1500)
    expect(parsed.truncated).toBe(true)
  })

  // A prefix of an address is a different address, and the source link is built
  // from it, so an address that cannot be kept whole is left out.
  it('leaves out a url that cannot be kept whole instead of cutting it', async () => {
    const url = `https://example.com/${'u'.repeat(20000)}`
    h.webFetch.mockResolvedValue({
      title: 'Trending',
      url,
      content: 'x'.repeat(5000),
      truncated: false,
    })

    const text = await fetchText(3600)

    expect(parseWebFetchOutput(text)!.url).toBeUndefined()
    expect(text).not.toContain('uuuuu')
  })

  it('keeps a long url whole when everything fits', async () => {
    const url = `https://example.com/${'a'.repeat(300)}`
    h.webFetch.mockResolvedValue({
      title: 'T'.repeat(300),
      url,
      content: 'short page',
      truncated: false,
    })

    const parsed = parseWebFetchOutput(await fetchText(1000))!

    expect(parsed.url).toBe(url)
    expect(parsed.title).toBe('T'.repeat(300))
    expect(parsed.content).toBe('short page')
    expect(parsed.truncated).toBe(false)
  })

  it('says the result was cut whenever the title or the url was', async () => {
    h.webFetch.mockResolvedValue({
      title: 'T'.repeat(5000),
      url: 'https://example.com/a',
      content: 'short page',
      truncated: false,
    })

    const parsed = parseWebFetchOutput(await fetchText(1000))!

    expect(parsed.title!.length).toBeLessThan(5000)
    expect(parsed.truncated).toBe(true)
  })

  it('leaves a normal title and url untouched', async () => {
    h.webFetch.mockResolvedValue(page('short page'))

    expect(await fetchText(3600)).toContain(
      'Title: Trending\nURL: https://github.com/trending\n\n'
    )
  })

  it('never exceeds a budget too small for the header, and still says it was cut', async () => {
    h.webFetch.mockResolvedValue(page('x'.repeat(5000)))

    const text = await fetchText(40)

    expect(text.length).toBeLessThanOrEqual(40)
    // The marker the page widget reads, so the cut is still reported to the user.
    expect(parseWebFetchOutput(text)).toMatchObject({ truncated: true })
    // Smaller than the marker itself: still inside the budget.
    expect((await fetchText(10)).length).toBeLessThanOrEqual(10)
  })
})

describe('webOutputCap', () => {
  it('is the setting alone when the model reports no window', () => {
    h.mcp.settings = { maxToolOutputChars: 12000 }
    expect(webOutputCap(undefined)).toBe(12000)
  })

  it('is nothing when neither applies', () => {
    h.mcp.settings = { maxToolOutputChars: 0 }
    expect(webOutputCap(undefined)).toBeUndefined()
  })
})
