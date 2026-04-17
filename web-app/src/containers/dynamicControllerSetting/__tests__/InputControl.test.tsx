import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, type, ...p }: any) => (
    <input data-testid="input" value={value ?? ''} onChange={onChange} placeholder={placeholder} type={type} {...p} />
  ),
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...p }: any) => <button onClick={onClick} {...p}>{children}</button>,
}))
vi.mock('@/components/ui/button-group', () => ({
  ButtonGroup: ({ children }: any) => <div data-testid="button-group">{children}</div>,
}))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('lucide-react', () => ({
  Copy: () => <span>Copy</span>, Eye: () => <span>Eye</span>,
  EyeOff: () => <span>EyeOff</span>, CopyCheck: () => <span>CopyCheck</span>,
}))
vi.mock('@tabler/icons-react', () => ({
  IconMinus: () => <span>-</span>, IconPlus: () => <span>+</span>,
}))

import { InputControl } from '../InputControl'

describe('InputControl', () => {
  it('renders text input with value', () => {
    render(<InputControl value="hello" onChange={vi.fn()} />)
    expect(screen.getByTestId('input')).toHaveValue('hello')
  })

  it('calls onChange on input change', () => {
    const onChange = vi.fn()
    render(<InputControl value="" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'new' } })
    expect(onChange).toHaveBeenCalledWith('new')
  })

  it('renders number input with increment/decrement', () => {
    render(<InputControl type="number" value={5} onChange={vi.fn()} min={0} max={10} step={1} />)
    expect(screen.getByTestId('button-group')).toBeInTheDocument()
    expect(screen.getByLabelText('Increment')).toBeInTheDocument()
    expect(screen.getByLabelText('Decrement')).toBeInTheDocument()
  })

  it('increments number value', () => {
    const onChange = vi.fn()
    render(<InputControl type="number" value={5} onChange={onChange} min={0} max={10} step={1} />)
    fireEvent.click(screen.getByLabelText('Increment'))
    expect(onChange).toHaveBeenCalledWith('6')
  })
})
