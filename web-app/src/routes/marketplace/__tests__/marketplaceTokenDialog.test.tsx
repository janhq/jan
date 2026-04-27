import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSetToken, mockUseModelScope } = vi.hoisted(() => ({
  mockSetToken: vi.fn(),
  mockUseModelScope: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useModelScope', () => ({
  useModelScope: mockUseModelScope,
}))

vi.mock('@/components/marketplace/ModelCard', () => ({
  ModelCard: () => <div data-testid="model-card" />,
}))

import { Route } from '../index'

describe('Marketplace token dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_MACOS', false)

    mockSetToken.mockResolvedValue(undefined)
    mockUseModelScope.mockReturnValue({
      models: [],
      totalCount: 0,
      loading: false,
      error: null,
      hasMore: false,
      params: {
        sort: 'downloads',
        page_number: 1,
        page_size: 20,
        filter_library: 'gguf',
      },
      token: 'ms-token-12345678',
      setToken: mockSetToken,
      updateParams: vi.fn(),
      loadMore: vi.fn(),
      resetFilters: vi.fn(),
    })
  })

  it('opens the token dialog instead of clearing a configured token on click', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType

    render(<Component />)

    await user.click(
      screen.getByRole('button', { name: 'ModelScope Token：已配置' })
    )

    expect(
      screen.getByRole('heading', { name: '管理 ModelScope Token' })
    ).toBeInTheDocument()
    expect(mockSetToken).not.toHaveBeenCalled()
  })

  it('requires confirmation before clearing a configured token', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType

    render(<Component />)

    await user.click(
      screen.getByRole('button', { name: 'ModelScope Token：已配置' })
    )
    await user.click(screen.getByRole('button', { name: '清除 Token…' }))

    expect(mockSetToken).not.toHaveBeenCalled()
    expect(
      screen.getByText('清除后将无法查看需要鉴权的 ModelScope 模型详情。')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认清除' }))

    await waitFor(() => {
      expect(mockSetToken).toHaveBeenCalledWith(null)
    })
  })
})
