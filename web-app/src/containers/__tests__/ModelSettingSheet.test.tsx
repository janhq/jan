import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { ModelSettingSheet } from '../ModelSetting'

const model = { id: 'm1', name: 'M1' } as unknown as Model
const provider = { provider: 'remote', models: [model], settings: [] } as unknown as ProviderObject

describe('ModelSettingSheet', () => {
  it('renders nothing while closed', () => {
    render(
      <ModelSettingSheet model={model} provider={provider} open={false} onOpenChange={vi.fn()} />
    )
    expect(screen.queryByText('common:modelSettings.description')).toBeNull()
  })

  it('shows the title and description when open and reports close', () => {
    const onOpenChange = vi.fn()
    render(
      <ModelSettingSheet model={model} provider={provider} open onOpenChange={onOpenChange} />
    )
    expect(screen.getByText('common:modelSettings.description')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
