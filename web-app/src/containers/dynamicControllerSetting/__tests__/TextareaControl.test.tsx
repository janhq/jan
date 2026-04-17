import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({ value, onChange, placeholder, rows, ...p }: any) => (
    <textarea data-testid="textarea" value={value} onChange={onChange} placeholder={placeholder} rows={rows} {...p} />
  ),
}))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({ spellCheckChatInput: false }),
}))

import { TextareaControl } from '../TextareaControl'

describe('TextareaControl', () => {
  it('renders textarea with value', () => {
    render(<TextareaControl value="test content" onChange={vi.fn()} />)
    expect(screen.getByTestId('textarea')).toHaveValue('test content')
  })

  it('renders placeholder', () => {
    render(<TextareaControl value="" placeholder="Enter text" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
  })

  it('calls onChange on input', () => {
    const onChange = vi.fn()
    render(<TextareaControl value="" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'new text' } })
    expect(onChange).toHaveBeenCalledWith('new text')
  })
})
