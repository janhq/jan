import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown">{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <div role="menuitem" onClick={onClick}>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('lucide-react', () => ({ ChevronsUpDown: () => <span /> }))

import { DropdownControl } from '../DropdownControl'

describe('DropdownControl', () => {
  const options = [
    { value: 'a', name: 'Option A' },
    { value: 'b', name: 'Option B' },
  ]

  it('renders selected value', () => {
    render(<DropdownControl value="a" options={options} onChange={vi.fn()} />)
    expect(screen.getAllByText('Option A').length).toBeGreaterThan(0)
  })

  it('renders all options', () => {
    render(<DropdownControl value="a" options={options} onChange={vi.fn()} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })

  it('calls onChange on option click', () => {
    const onChange = vi.fn()
    render(<DropdownControl value="a" options={options} onChange={onChange} />)
    fireEvent.click(screen.getByText('Option B'))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
