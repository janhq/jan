import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const t = (key: string) => key
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t }) }))

import { AddProviderDialog } from '../AddProviderDialog'

describe('AddProviderDialog', () => {
  it('labels the name field like the other fields', () => {
    render(
      <AddProviderDialog onCreateProvider={vi.fn()}>
        <button>open</button>
      </AddProviderDialog>
    )
    fireEvent.click(screen.getByText('open'))
    expect(screen.getByLabelText('provider:nameLabel')).toBe(
      screen.getByTestId('provider-name-input')
    )
  })
})
