import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <input type="checkbox" data-testid="switch" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

import { CheckboxControl } from '../CheckboxControl'

describe('CheckboxControl', () => {
  it('renders checked state', () => {
    render(<CheckboxControl checked={true} onChange={vi.fn()} />)
    expect(screen.getByTestId('switch')).toBeChecked()
  })

  it('renders unchecked state', () => {
    render(<CheckboxControl checked={false} onChange={vi.fn()} />)
    expect(screen.getByTestId('switch')).not.toBeChecked()
  })

  it('calls onChange on toggle', () => {
    const onChange = vi.fn()
    render(<CheckboxControl checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('switch'))
    expect(onChange).toHaveBeenCalled()
  })
})
