'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SidebarTrigger, useSidebar } from 'fumadocs-ui/layouts/docs/slots/sidebar'
import { MENU_BUTTON, MenuIcon } from '@/components/menu-icon'
import { MobileMenuFooter, MobileMenuTop } from '@/components/mobile-menu'

// Phones, doc pages: Fumadocs' own mobile header (title, search, page-list
// button) repeated the navbar, so it's replaced by one menu button in the
// navbar (#docs-sidebar-trigger) that opens the page-list drawer. It lives
// here, inside DocsLayout, so it can reach the drawer. The drawer then carries
// the same phone menu as the docs home (components/mobile-menu.tsx) around
// the page list.
export function NavbarSidebarTrigger() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const { open } = useSidebar()
  useEffect(() => setSlot(document.getElementById('docs-sidebar-trigger')), [])
  if (!slot) return null

  return createPortal(
    <SidebarTrigger aria-label={open ? 'Close menu' : 'Open menu'} className={MENU_BUTTON}>
      <MenuIcon open={open} />
    </SidebarTrigger>,
    slot
  )
}

/** Top of the phone drawer (sidebar banner): doc-set pills, theme, search. */
export function DrawerBanner() {
  const { setOpen } = useSidebar()
  return <MobileMenuTop onSearch={() => setOpen(false)} />
}

/** Bottom of the phone drawer (sidebar footer): Download. */
export function DrawerFooter() {
  return <MobileMenuFooter />
}

/** Renders nothing: fills Fumadocs slots we don't want (e.g. the phone
 *  "On this page" bar). */
export function EmptySlot() {
  return null
}

/** Empty sidebar title: the navbar already shows the logo. */
export function NoNavTitle() {
  return null
}
