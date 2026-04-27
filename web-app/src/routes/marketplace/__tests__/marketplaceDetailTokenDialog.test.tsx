import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDownloadDir,
  mockFetchDetail,
  mockFetchModelScopeFiles,
  mockInvoke,
  mockUseModelScopeDetail,
} = vi.hoisted(() => ({
  mockDownloadDir: vi.fn(),
  mockFetchDetail: vi.fn(),
  mockFetchModelScopeFiles: vi.fn(),
  mockInvoke: vi.fn(),
  mockUseModelScopeDetail: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: unknown) => ({ ...(config as object), id: path }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ modelId: 'owner/repo' }),
  useSearch: () => ({ repo: 'owner/repo' }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useModelScope', () => ({
  useModelScopeDetail: mockUseModelScopeDetail,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      fetchModelScopeFiles: mockFetchModelScopeFiles,
    }),
  }),
}))

vi.mock('@/hooks/useDownloadStore', () => ({
  useDownloadStore: () => ({
    downloads: {},
    localDownloadingModels: [],
    addLocalDownloadingModel: vi.fn(),
    removeLocalDownloadingModel: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    getProviderByName: vi.fn(() => undefined),
  }),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: () => <div />,
}))

vi.mock('@/components/marketplace/DownloadDialog', () => ({
  DownloadDialog: () => null,
}))

vi.mock('@/components/marketplace/QuantSelector', () => ({
  QuantSelector: () => null,
}))

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: mockDownloadDir,
}))

import { Route } from '../$modelId'

describe('Marketplace detail token dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_MACOS', false)

    mockDownloadDir.mockResolvedValue('C:\\Downloads')
    mockFetchModelScopeFiles.mockResolvedValue(null)
    mockFetchDetail.mockResolvedValue(undefined)
    mockInvoke.mockImplementation(async (command: string, payload?: { token?: string }) => {
      if (command === 'get_modelscope_token') return 'ms-token-12345678'
      if (command === 'save_modelscope_token') return payload?.token
      if (command === 'clear_modelscope_token') return undefined
      return undefined
    })

    mockUseModelScopeDetail.mockReturnValue({
      detail: null,
      loading: false,
      error: null,
      needsAuth: false,
      fetchDetail: mockFetchDetail,
    })
  })

  it('opens the management dialog from the header token button', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType

    render(<Component />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'ModelScope Token：已配置' })
      ).toBeInTheDocument()
    })

    await user.click(
      screen.getByRole('button', { name: 'ModelScope Token：已配置' })
    )

    expect(
      screen.getByRole('heading', { name: '管理 ModelScope Token' })
    ).toBeInTheDocument()
    expect(mockInvoke).not.toHaveBeenCalledWith('clear_modelscope_token')
  })

  it('requires confirmation before clearing the saved token', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType

    render(<Component />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'ModelScope Token：已配置' })
      ).toBeInTheDocument()
    })

    await user.click(
      screen.getByRole('button', { name: 'ModelScope Token：已配置' })
    )
    await user.click(screen.getByRole('button', { name: '清除 Token…' }))

    expect(mockInvoke).not.toHaveBeenCalledWith('clear_modelscope_token')
    expect(
      screen.getByText('清除后将无法查看需要鉴权的 ModelScope 模型详情。')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认清除' }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('clear_modelscope_token')
    })
  })
})
