import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mermaid renders in the browser after the rehype pass, and its image shape
// (`A@{ img: "https://..." }`) loads a URL that no hast plugin ever sees. So
// the only safe answer for extension-authored content is to not run it.
const seen = vi.hoisted(() => ({ plugins: [] as Array<Record<string, unknown>> }))
vi.mock('streamdown', async (importOriginal) => ({
  ...(await importOriginal<typeof import('streamdown')>()),
  Streamdown: ({ plugins }: { plugins: Record<string, unknown> }) => {
    seen.plugins.push(plugins)
    return null
  },
}))

import { RenderMarkdown } from '../RenderMarkdown'

describe('RenderMarkdown plugins', () => {
  it('runs mermaid only for content no extension authored', () => {
    render(<RenderMarkdown content="a" />)
    render(<RenderMarkdown content="b" noRemoteImages />)
    expect(seen.plugins[0]).toHaveProperty('mermaid')
    expect(seen.plugins[1]).not.toHaveProperty('mermaid')
    expect(seen.plugins[1]).toHaveProperty('code')
  })
})
