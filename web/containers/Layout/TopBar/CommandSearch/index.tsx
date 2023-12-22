import { Fragment, useState, useEffect } from 'react'

import {
  CommandModal,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandShortcut,
  CommandList,
} from '@janhq/uikit'

import { MessageCircleIcon, SettingsIcon, LayoutGridIcon } from 'lucide-react'

import ShortCut from '@/containers/Shortcut'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

const menus = [
  {
    name: 'Chat',
    icon: (
      <MessageCircleIcon size={16} className="mr-3 text-muted-foreground" />
    ),
    state: MainViewState.Thread,
  },
  {
    name: 'Hub',
    icon: <LayoutGridIcon size={16} className="mr-3 text-muted-foreground" />,
    state: MainViewState.Hub,
  },
  {
    name: 'Settings',
    icon: <SettingsIcon size={16} className="mr-3 text-muted-foreground" />,
    state: MainViewState.Settings,
    shortcut: <ShortCut menu="," />,
  },
]

export default function CommandSearch() {
  const { setMainViewState } = useMainViewState()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setMainViewState(MainViewState.Settings)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Fragment>
      <CommandModal open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            {menus.map((menu, i) => {
              return (
                <CommandItem
                  key={i}
                  value={menu.name}
                  onSelect={() => {
                    setMainViewState(menu.state)
                    setOpen(false)
                  }}
                >
                  {menu.icon}
                  <span>{menu.name}</span>
                  {menu.shortcut && (
                    <CommandShortcut>{menu.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </CommandModal>
    </Fragment>
  )
}
