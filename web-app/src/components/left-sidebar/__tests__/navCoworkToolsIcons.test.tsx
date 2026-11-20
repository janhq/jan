import '@testing-library/jest-dom/vitest'
import type { ComponentProps, ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/containers/dialogs/SkillsManagerDialog', () => ({ default: () => null }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: (props: ComponentProps<'button'> & { asChild?: boolean }) => {
    const { asChild, ...rest } = props
    void asChild
    return <button {...rest} />
  },
}))

import { NavCoworkTools } from '../NavCoworkTools'

// index.css sets `svg.lucide { width: 14px; height: 14px }` globally, which made
// the Artifacts and Skills icons 14px next to 16px icons in every other row.
// The wrapper must carry a rule that wins over it.
it.each(['artifacts', 'customize'] as const)('%s icon opts out of the global 14px lucide size', (section) => {
  render(<NavCoworkTools section={section} />)
  const svg = screen.getByTestId(`nav-${section}`).querySelector('svg')!
  expect(svg).toHaveAttribute('width', '16')
  expect(svg.closest('div[class*="size-4"]')?.className).toContain('[&_svg]:size-4')
})
