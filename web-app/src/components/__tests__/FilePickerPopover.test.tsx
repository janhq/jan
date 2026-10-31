import { render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { FilePickerPopover } from '../FilePickerPopover'
import { ModalLayerContext } from '../ui/overlay-layer'

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })

const entry = { path: '/report.md', name: 'report.md', kind: 'file' as const }
function setup(modal = false) {
  const textarea = document.createElement('textarea')
  document.body.append(textarea)
  vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({ left: 30, bottom: 500 } as DOMRect)
  const select = vi.fn()
  const result = render(<ModalLayerContext.Provider value={modal}><div data-testid="composer" className="relative z-20 overflow-hidden"><FilePickerPopover entries={[entry]} query="report" open position={{ top: -100, left: 0 }} textareaRef={{ current: textarea }} onSelect={select} onClose={vi.fn()} /></div></ModalLayerContext.Provider>)
  return { textarea, select, ...result }
}
describe('FilePickerPopover portal', () => {
  it('escapes the composer stacking context and converts offsets to viewport coordinates', () => {
    const { textarea, select, unmount } = setup()
    const list = screen.getByRole('listbox')
    expect(list.parentElement).toBe(document.body)
    expect(list).toHaveClass('fixed', 'z-(--layer-floating)')
    expect(list).toHaveStyle({ left: '30px', top: '400px' })
    textarea.focus()
    fireEvent.pointerDown(screen.getByRole('option'))
    expect(textarea).toHaveFocus()
    fireEvent.click(screen.getByRole('option'))
    expect(select).toHaveBeenCalledWith(entry)
    unmount()
    textarea.remove()
  })
  it('inherits modal ownership across the portal', () => {
    const { textarea, unmount } = setup(true)
    expect(screen.getByRole('listbox')).toHaveClass('z-(--layer-modal-floating)')
    unmount()
    textarea.remove()
  })
})
