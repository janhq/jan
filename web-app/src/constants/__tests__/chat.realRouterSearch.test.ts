import { describe, it, expect } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router'
import { isTemporaryChatSearch } from '../chat'

// Real TanStack router + memory history with the project's default
// parseSearch/stringifySearch (main.tsx uses createRouter({ routeTree })).
// No router mocks: we classify the router's actual location.searchStr.
async function searchStrFor(url: string): Promise<string> {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  await router.load()
  return router.state.location.searchStr
}

describe('isTemporaryChatSearch with real router searchStr', () => {
  it('normalizes duplicate flags through the default parser and stringifier', () => {
    expect(defaultStringifySearch(defaultParseSearch('?temporary-chat=true&temporary-chat=false'))).toBe(
      '?temporary-chat=%5Btrue%2Cfalse%5D'
    )
  })

  const cases: Array<[string, string, boolean]> = [
    ['plain true', '/?temporary-chat=true', true],
    ['plain false', '/?temporary-chat=false', false],
    ['missing', '/?other=1', false],
    ['encoded value', '/?temporary-chat=%74rue', true],
    ['encoded key', '/?temporary%2Dchat=true', true],
    ['encoded key and value', '/?temporary%2Dchat=%74rue', true],
    // The default router parser folds duplicates into a JSON array and the
    // stringifier re-encodes it (e.g. `%5Btrue%2Cfalse%5D`). The helper fails
    // privacy-closed: an array containing boolean true is temporary in any order.
    ['first duplicate false, second true', '/?temporary-chat=false&temporary-chat=true', true],
    ['first duplicate true, second false', '/?temporary-chat=true&temporary-chat=false', true],
    ['first duplicate true, second true', '/?temporary-chat=true&temporary-chat=true', true],
    ['duplicate false only', '/?temporary-chat=false&temporary-chat=false', false],
    ['duplicate substring only', '/?temporary-chat=truex&temporary-chat=xtrue', false],
    ['duplicate substring and true', '/?temporary-chat=truex&temporary-chat=true', true],
    ['substring value', '/?temporary-chat=truex', false],
    ['substring value prefix', '/?temporary-chat=xtrue', false],
    ['substring key suffix', '/?x-temporary-chat=true', false],
    ['substring key prefix', '/?temporary-chat-x=true', false],
    ['invalid value casing', '/?temporary-chat=TRUE', false],
  ]

  it.each(cases)('%s: %s', async (_name, url, expected) => {
    const searchStr = await searchStrFor(url)
    // Helper must agree with the exact string the router exposes.
    expect(isTemporaryChatSearch(searchStr)).toBe(expected)
  })

  it('pins the router-normalized searchStr for duplicates and encoded input', async () => {
    expect(await searchStrFor('/?temporary-chat=true&temporary-chat=false')).toBe(
      '?temporary-chat=%5Btrue%2Cfalse%5D'
    )
    expect(await searchStrFor('/?temporary%2Dchat=%74rue')).toBe('?temporary-chat=true')
  })

  it('normalizes duplicates to a JSON array value that still classifies temporary', async () => {
    // Actual router duplicate normalization: the decoded value is the JSON
    // array text, never the exact string `true`, regardless of duplicate order.
    for (const url of [
      '/?temporary-chat=true&temporary-chat=false',
      '/?temporary-chat=false&temporary-chat=true',
    ]) {
      const searchStr = await searchStrFor(url)
      const value = new URLSearchParams(searchStr).get('temporary-chat')
      expect(value).toMatch(/^\[.*\]$/)
      expect(value).not.toBe('true')
      expect(isTemporaryChatSearch(searchStr)).toBe(true)
    }
  })

  it('agrees with raw duplicate semantics on both raw URL and router searchStr', async () => {
    for (const raw of [
      '?temporary-chat=true&temporary-chat=false',
      '?temporary-chat=false&temporary-chat=true',
    ]) {
      expect(isTemporaryChatSearch(raw)).toBe(true)
      expect(isTemporaryChatSearch(await searchStrFor('/' + raw))).toBe(true)
    }
  })
})
