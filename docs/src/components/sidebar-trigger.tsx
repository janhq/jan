'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PanelLeft } from 'lucide-react'
import { SidebarTrigger } from 'fumadocs-ui/layouts/docs/slots/sidebar'

// Replaces Fumadocs' mobile header bar (title, search, sidebar button), which
// repeated the Jan navbar. Only the sidebar button is kept, rendered into the
// navbar's slot (#docs-sidebar-trigger). It lives here, inside DocsLayout, so
// it can still open the sidebar drawer.
export function NavbarSidebarTrigger() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('docs-sidebar-trigger')), [])
  if (!slot) return null

  return createPortal(
    <SidebarTrigger
      aria-label="Open page list"
      className="focus-ring flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink/60 transition-colors duration-150 ease-jan hover:text-ink"
    >
      <PanelLeft className="size-[18px]" strokeWidth={1.75} />
    </SidebarTrigger>,
    slot
  )
}

/** Empty sidebar title: the navbar already shows the logo. */
export function NoNavTitle() {
  return null
}
