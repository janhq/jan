import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import en from '@/locales/en/common.json'

const h = vi.hoisted(() => ({ toastSuccess: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: vi.fn() } }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children, onSelect, ...props }: { children: React.ReactNode; onSelect?: unknown }) => {
    void onSelect
    return <button {...props}>{children}</button>
  },
}))
// Resolve keys against the real English bundle, so the copy itself is under test.
const t = (key: string) =>
  key
    .replace(/^common:/, '')
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en) as string
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t }) }))

import { DeleteAllThreadsDialog } from '../DeleteAllThreadsDialog'

describe('DeleteAllThreadsDialog copy', () => {
  it('says conversations outside projects are deleted and project conversations and tasks are kept', () => {
    const onDeleteAll = vi.fn()
    render(<DeleteAllThreadsDialog onDeleteAll={onDeleteAll} />)
    fireEvent.click(screen.getByText('Delete All'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/outside projects/i)
    expect(dialog).toHaveTextContent(/project conversations.*tasks are kept/i)
    expect(dialog).not.toHaveTextContent(/all threads will be deleted/i)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete All' }))
    expect(onDeleteAll).toHaveBeenCalled()
    const [title, options] = h.toastSuccess.mock.calls[0]
    expect(title).toBe('Conversations deleted')
    expect(options.description).toMatch(/outside projects.*kept/i)
  })
})
