import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { RenderMarkdown } from '@/containers/RenderMarkdown'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
}))

const writeText = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(cleanup)

const content = '| Expression |\n| --- |\n| `"a  b"` |'

describe('Markdown table export preserves literal code', () => {
  it('preserves spaces inside rendered code when copying CSV', async () => {
    const { container } = render(<RenderMarkdown content={content} />)
    expect(container.querySelector('td code')?.textContent).toBe('"a  b"')
    fireEvent.click(screen.getByText('Copy as CSV'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Expression\n"""a  b"""'))
  })

  it('preserves spaces inside rendered code when copying Markdown', async () => {
    render(<RenderMarkdown content={content} />)
    fireEvent.click(screen.getByText('Copy as Markdown'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      '| Expression |\n| --- |\n| "a  b" |'
    ))
  })

  it('preserves literal spaces without changing surrounding prose extraction', async () => {
    render(<RenderMarkdown content={'| Description |\n| --- |\n| Prefix **bold** `a  b` suffix |'} />)
    fireEvent.click(screen.getByText('Copy as CSV'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Description\nPrefix bold a  b suffix'))
  })

  it('still normalizes ordinary prose whitespace', async () => {
    render(<RenderMarkdown content={'| Name |\n| --- |\n| plain   value |'} />)
    fireEvent.click(screen.getByText('Copy as CSV'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Name\nplain value'))
  })

  it('does not trim significant code whitespace at cell boundaries', async () => {
    const { container } = render(<RenderMarkdown content={'| Expression |\n| --- |\n| `  a   ` |'} />)
    expect(container.querySelector('td code')?.textContent).toBe(' a  ')
    fireEvent.click(screen.getByText('Copy as CSV'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Expression\n a  '))
  })

  it('preserves literal spaces in downloaded CSV', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('Blob', class {
      constructor(public parts: string[], public options: { type: string }) {}
    })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      render(<RenderMarkdown content={content} />)
      fireEvent.click(screen.getByText('Download .csv'))
      expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({
        parts: ['Expression\n"""a  b"""'], options: { type: 'text/csv' },
      }))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    } finally {
      click.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
