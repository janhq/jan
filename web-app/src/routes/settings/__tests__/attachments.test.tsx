import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => undefined }) },
}))
vi.mock('@janhq/core', () => ({ ExtensionTypeEnum: { RAG: 'rag' } }))
// Simple number input so the test can drive onChange directly.
vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: ({
    controllerProps,
    disabledReason,
    onChange,
  }: any) => (
    <input
      data-testid={`ctl-${controllerProps.max}`}
      data-disabled-reason={disabledReason}
      value={controllerProps.value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

import { Route } from '../attachments'
import { useImageAttachmentConfig } from '@/hooks/useImageAttachmentConfig'
import { useAttachments } from '@/hooks/useAttachments'

const Page = (Route as unknown as { component: () => JSX.Element }).component

describe('Attachments settings: image size', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useImageAttachmentConfig.setState({ maxImageSizeMB: 10 })
    useAttachments.setState({
      settingsDefs: [
        {
          key: 'max_file_size_mb',
          titleKey: 'settings:attachments.maxFile',
          descriptionKey: 'settings:attachments.maxFileDesc',
          controllerType: 'input',
          controllerProps: { value: 100, type: 'number', min: 1, max: 200 },
        } as any,
      ],
      maxFileSizeMB: 100,
      enabled: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the document and image limits as separate settings with the provider note', () => {
    render(<Page />)
    expect(
      screen.getByText('settings:attachments.maxFile')
    ).toBeInTheDocument()
    expect(
      screen.getByText('settings:attachments.maxImage')
    ).toBeInTheDocument()
    expect(
      screen.getByText('settings:attachments.maxImageDesc')
    ).toBeInTheDocument()
    expect(screen.getByTestId('ctl-100')).toHaveValue('10')
    expect(screen.getByTestId('ctl-200')).toHaveValue('100')
  })

  it('saves an image limit change without touching the document limit', () => {
    render(<Page />)
    fireEvent.change(screen.getByTestId('ctl-100'), { target: { value: '30' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(30)
    expect(useAttachments.getState().maxFileSizeMB).toBe(100)
  })

  it.each([
    ['25', 25],
    ['999', 100],
    ['invalid', 10],
  ])('saves %s when leaving before the debounce expires', (value, expected) => {
    const page = render(<Page />)
    fireEvent.change(screen.getByTestId('ctl-100'), { target: { value: '20' } })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.change(screen.getByTestId('ctl-100'), { target: { value } })
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(10)

    page.unmount()

    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(expected)
    expect(useAttachments.getState().maxFileSizeMB).toBe(100)
    // An older scheduled edit must not overwrite the last value later.
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(expected)
    render(<Page />)
    expect(screen.getByTestId('ctl-100')).toHaveValue(String(expected))
  })

  it('clamps an out-of-range image limit to 100', () => {
    render(<Page />)
    fireEvent.change(screen.getByTestId('ctl-100'), { target: { value: '999' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(useImageAttachmentConfig.getState().maxImageSizeMB).toBe(100)
  })

  it('lists the image limit before the document limit', () => {
    render(<Page />)
    const image = screen.getByTestId('ctl-100')
    const document = screen.getByTestId('ctl-200')
    expect(
      image.compareDocumentPosition(document) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  // The toggle governs documents only: images never check it, so only the
  // document limit is greyed out while it is off.
  it('disables only the document limit while attachments are off', () => {
    useAttachments.setState({ enabled: false })
    render(<Page />)
    expect(screen.getByTestId('ctl-200')).toHaveAttribute(
      'data-disabled-reason',
      'settings:attachments.maxFileDisabledReason'
    )
    expect(screen.getByTestId('ctl-100')).not.toHaveAttribute(
      'data-disabled-reason'
    )
  })

  it('leaves both limits editable while attachments are on', () => {
    render(<Page />)
    expect(screen.getByTestId('ctl-200')).not.toHaveAttribute(
      'data-disabled-reason'
    )
    expect(screen.getByTestId('ctl-100')).not.toHaveAttribute(
      'data-disabled-reason'
    )
  })

  // pointer-events-none alone leaves a control reachable by keyboard, so the
  // document limit must be inert, not just styled, while attachments are off.
  it('makes only the document limit inert while attachments are off', () => {
    useAttachments.setState({ enabled: false })
    render(<Page />)
    expect(screen.getByTestId('ctl-200').closest('[inert]')).not.toBeNull()
    expect(screen.getByTestId('ctl-100').closest('[inert]')).toBeNull()
  })

  it('keeps both limits out of an inert subtree while attachments are on', () => {
    render(<Page />)
    expect(screen.getByTestId('ctl-200').closest('[inert]')).toBeNull()
    expect(screen.getByTestId('ctl-100').closest('[inert]')).toBeNull()
  })

  it('shows the reason as a tooltip on an element that still gets hover', () => {
    useAttachments.setState({ enabled: false })
    render(<Page />)
    const holder = screen
      .getByTestId('ctl-200')
      .closest('[title="settings:attachments.maxFileDisabledReason"]')
    expect(holder).not.toBeNull()
    expect(holder?.hasAttribute('inert')).toBe(false)
  })
})
