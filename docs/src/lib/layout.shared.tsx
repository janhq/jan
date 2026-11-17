import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { NavbarSidebarTrigger, NoNavTitle } from '@/components/sidebar-trigger'

export function baseOptions(): BaseLayoutProps {
  return {
    // The Jan navbar (components/navbar.tsx) sits above the layout and already
    // has the logo, search and theme switch, so Fumadocs shows none of its own:
    // no title or search at the top of the sidebar, and no mobile header bar
    // (its sidebar button moves into the navbar).
    nav: { component: <NavbarSidebarTrigger /> },
    slots: { navTitle: NoNavTitle },
    searchToggle: { enabled: false },
    themeSwitch: { enabled: false },
  }
}
