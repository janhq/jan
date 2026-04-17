import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: () => ({
    notificationPosition: 'top-right',
    setNotificationPosition: vi.fn(),
  }),
}))
vi.mock('@/utils/toastPlacement', () => ({
  NOTIFICATION_POSITIONS: ['top-right', 'top-left', 'bottom-right', 'bottom-left'],
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { NotificationPositionSwitcher } from '../NotificationPositionSwitcher'

describe('NotificationPositionSwitcher', () => {
  it('renders with current position label', () => {
    render(<NotificationPositionSwitcher />)
    expect(screen.getByText('settings:interface.notificationPositionTopRight')).toBeDefined()
  })
})
