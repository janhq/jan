import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const t = (key: string) => key
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t }),
}))

import { AddProviderDialog } from '../AddProviderDialog'

const openDialog = async () => {
  const user = userEvent.setup()
  render(
    <AddProviderDialog onCreateProvider={vi.fn()}>
      <button>open</button>
    </AddProviderDialog>
  )
  await user.click(screen.getByText('open'))
  return user
}

const fillNameAndUrl = (
  name = 'mlx-local',
  url = 'http://127.0.0.1:8000/v1'
) => {
  fireEvent.change(
    screen.getByPlaceholderText('provider:enterNameForProvider'),
    { target: { value: name } }
  )
  fireEvent.change(screen.getByPlaceholderText('provider:baseUrlPlaceholder'), {
    target: { value: url },
  })
}

describe('AddProviderDialog', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('enables Create for an OpenAI-compatible provider with no API key', async () => {
    await openDialog()
    fillNameAndUrl()

    const create = screen.getByRole('button', { name: 'common:create' })
    expect(create).toBeEnabled()
  })

  it('creates an OpenAI-compatible provider with an empty API key', async () => {
    const onCreateProvider = vi.fn()
    const user = userEvent.setup()
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>open</button>
      </AddProviderDialog>
    )
    await user.click(screen.getByText('open'))
    fillNameAndUrl()
    await user.click(screen.getByRole('button', { name: 'common:create' }))

    expect(onCreateProvider).toHaveBeenCalledWith(
      'mlx-local',
      'http://127.0.0.1:8000/v1',
      '',
      'openai'
    )
  })

  it('keeps Create disabled for Anthropic-compatible providers until an API key is entered', async () => {
    const user = await openDialog()
    fillNameAndUrl()
    await user.click(screen.getByText('provider:apiTypeAnthropic'))

    const create = screen.getByRole('button', { name: 'common:create' })
    expect(create).toBeDisabled()

    fireEvent.change(
      screen.getByPlaceholderText('provider:apiKeyPlaceholder'),
      { target: { value: 'sk-ant-test' } }
    )
    expect(create).toBeEnabled()
  })

  it('creates an Anthropic-compatible provider with the supplied key', async () => {
    const onCreateProvider = vi.fn()
    const user = userEvent.setup()
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>open</button>
      </AddProviderDialog>
    )
    await user.click(screen.getByText('open'))
    fillNameAndUrl('claude-proxy', 'https://api.anthropic.com/v1')
    await user.click(screen.getByText('provider:apiTypeAnthropic'))
    fireEvent.change(
      screen.getByPlaceholderText('provider:apiKeyPlaceholder'),
      { target: { value: ' sk-ant-test ' } }
    )
    await user.click(screen.getByRole('button', { name: 'common:create' }))

    expect(onCreateProvider).toHaveBeenCalledWith(
      'claude-proxy',
      'https://api.anthropic.com/v1',
      'sk-ant-test',
      'anthropic'
    )
  })

  it('rejects an invalid base URL even when the API key is optional', async () => {
    const onCreateProvider = vi.fn()
    const user = userEvent.setup()
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>open</button>
      </AddProviderDialog>
    )
    await user.click(screen.getByText('open'))
    fillNameAndUrl('local', 'not-a-url')
    await user.click(screen.getByRole('button', { name: 'common:create' }))

    expect(screen.getByText('provider:invalidBaseUrl')).toBeInTheDocument()
    expect(onCreateProvider).not.toHaveBeenCalled()
  })

  it('strips a trailing slash from the base URL', async () => {
    const onCreateProvider = vi.fn()
    const user = userEvent.setup()
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>open</button>
      </AddProviderDialog>
    )
    await user.click(screen.getByText('open'))
    fillNameAndUrl('lmstudio', 'http://127.0.0.1:1234/v1/')
    await user.click(screen.getByRole('button', { name: 'common:create' }))

    expect(onCreateProvider).toHaveBeenCalledWith(
      'lmstudio',
      'http://127.0.0.1:1234/v1',
      '',
      'openai'
    )
  })
})
