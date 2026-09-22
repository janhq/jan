import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const { getEngineVersion } = vi.hoisted(() => ({
  getEngineVersion: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ models: () => ({ getEngineVersion }) }),
}))

import { LlamacppEngineInfo } from '../LlamacppEngineInfo'

const PIN = {
  version: '0.4.1',
  tag: 'b10964',
  buildNumber: '10964',
  commit: 'b29c606e28a01b1bc8c1351026a0fa6e616bf6c4',
}

describe('LlamacppEngineInfo', () => {
  beforeEach(() => {
    getEngineVersion.mockReset()
  })

  it('names the engine and its version', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(await screen.findByText('llama.cpp')).toBeInTheDocument()
    expect(screen.getByText('0.4.1')).toBeInTheDocument()
    expect(screen.getByText('b10964')).toBeInTheDocument()
  })

  // A 40-char sha would wrap the row and buys nothing a reader can use; the
  // link is what gets them to the full commit.
  it('shortens the commit and links the build to its upstream release', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(await screen.findByText('b29c606e')).toBeInTheDocument()
    expect(screen.queryByText(PIN.commit)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /engineReleaseNotes/ })
    ).toHaveAttribute(
      'href',
      'https://github.com/ggml-org/llama.cpp/releases/tag/b10964'
    )
  })

  // A panel with blanks in it makes a weaker claim than no panel: on a build
  // with no engine there is nothing truthful to show.
  it('renders nothing when the version is unavailable', async () => {
    getEngineVersion.mockResolvedValue(null)
    const { container } = render(<LlamacppEngineInfo />)
    await waitFor(() => expect(getEngineVersion).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden while the call is still in flight', () => {
    getEngineVersion.mockReturnValue(new Promise(() => {}))
    const { container } = render(<LlamacppEngineInfo />)
    expect(container).toBeEmptyDOMElement()
  })
})
