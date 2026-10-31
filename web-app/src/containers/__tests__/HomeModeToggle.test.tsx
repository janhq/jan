import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HomeMode } from '@/hooks/useHomeMode'
import { HomeModeToggle } from '../HomeModeToggle'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function Harness({ initialMode = 'chat' }: { initialMode?: HomeMode }) {
  const [mode, setMode] = useState<HomeMode>(initialMode)
  return (
    <>
      <button>Before</button>
      <HomeModeToggle mode={mode} onChange={setMode} />
      <button>After</button>
    </>
  )
}

function expectSelected(mode: HomeMode) {
  for (const value of ['chat', 'cowork']) {
    const radio = screen.getByTestId(`home-mode-${value}`)
    expect(radio).toHaveAttribute('aria-checked', String(mode === value))
    expect(radio).toHaveAttribute('tabindex', mode === value ? '0' : '-1')
  }
}

describe('HomeModeToggle keyboard semantics', () => {
  it.each<HomeMode>(['chat', 'cowork'])(
    'tabs into only the selected %s radio and exits the group',
    async (initialMode) => {
      const user = userEvent.setup()
      render(<Harness initialMode={initialMode} />)

      expect(screen.getByRole('radiogroup')).toHaveAttribute(
        'aria-orientation',
        'horizontal'
      )
      expectSelected(initialMode)
      await user.tab()
      expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
      await user.tab()
      expect(screen.getByTestId(`home-mode-${initialMode}`)).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
      await user.tab({ shift: true })
      expect(screen.getByTestId(`home-mode-${initialMode}`)).toHaveFocus()
      await user.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
    }
  )

  it.each(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'])(
    '%s selects, focuses, wraps, and leaves one tab stop',
    async (key) => {
      const user = userEvent.setup()
      render(<Harness />)
      await user.tab()
      await user.tab()
      await user.keyboard(`{${key}}`)
      expectSelected('cowork')
      expect(screen.getByTestId('home-mode-cowork')).toHaveFocus()
      await user.keyboard(`{${key}}`)
      expectSelected('chat')
      expect(screen.getByTestId('home-mode-chat')).toHaveFocus()
      await user.keyboard(`{${key}}`)
      await user.tab()
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
      await user.tab({ shift: true })
      expect(screen.getByTestId('home-mode-cowork')).toHaveFocus()
    }
  )

  it('supports Home and End without moving focus out of the group', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.tab()
    await user.tab()
    for (const [key, mode] of [
      ['End', 'cowork'],
      ['End', 'cowork'],
      ['Home', 'chat'],
      ['Home', 'chat'],
    ] as const) {
      await user.keyboard(`{${key}}`)
      expectSelected(mode)
      expect(screen.getByTestId(`home-mode-${mode}`)).toHaveFocus()
    }
  })

  it('keeps native click and Space activation and controlled selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <HomeModeToggle mode="chat" onChange={onChange} />
    )
    await user.click(screen.getByTestId('home-mode-cowork'))
    expect(onChange).toHaveBeenLastCalledWith('cowork')
    expectSelected('chat')
    onChange.mockClear()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cowork')
    expectSelected('chat')

    rerender(<HomeModeToggle mode="cowork" onChange={onChange} />)
    expectSelected('cowork')
    onChange.mockClear()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('chat')
    expect(screen.getByTestId('home-mode-chat')).toHaveFocus()
    expectSelected('cowork')
  })
})
