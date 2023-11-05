import { Fragment, useState, useEffect, useContext } from 'react'

import {
  Button,
  CommandModal,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandShortcut,
  CommandList,
} from '@janhq/uikit'

import {
  MessageCircleIcon,
  SettingsIcon,
  BotIcon,
  LayoutGridIcon,
  CpuIcon,
  BookOpenIcon,
} from 'lucide-react'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

export default function CommandSearch() {
  const { experimentalFeatureEnabed } = useContext(FeatureToggleContext)

  const { setMainViewState } = useMainViewState()

  const [open, setOpen] = useState(false)
  const menus = [
    {
      name: 'Getting Started',
      icon: <BookOpenIcon size={16} className="mr-3 text-muted-foreground" />,
      state: MainViewState.Welcome,
    },
    {
      name: 'Chat',
      icon: (
        <MessageCircleIcon size={16} className="mr-3 text-muted-foreground" />
      ),
      state: MainViewState.Chat,
    },
    ...(experimentalFeatureEnabed
      ? [
          {
            name: 'Bot',
            icon: <BotIcon size={16} className="mr-3 text-muted-foreground" />,
            state: MainViewState.CreateBot,
          },
        ]
      : []),
    {
      name: 'Explore Models',
      icon: <CpuIcon size={16} className="mr-3 text-muted-foreground" />,
      state: MainViewState.ExploreModels,
    },
    {
      name: 'My Models',
      icon: <LayoutGridIcon size={16} className="mr-3 text-muted-foreground" />,
      state: MainViewState.MyModels,
    },
    {
      name: 'Settings',
      icon: <SettingsIcon size={16} className="mr-3 text-muted-foreground" />,
      state: MainViewState.Setting,
      shortcut: '⌘,',
    },
  ]

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      console.log(e)
      if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setMainViewState(MainViewState.Setting)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <Fragment>
      <div className="relative">
        <Button
          themes="outline"
          className="unset-drag h-8 w-[280px] justify-start text-left text-xs text-muted-foreground focus:ring-0"
          onClick={() => setOpen((open) => !open)}
        >
          Search menus...
        </Button>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-secondary px-1 py-0.5 text-xs font-bold text-muted-foreground">
          ⌘ j
        </div>
      </div>

      <CommandModal open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            {menus.map((menu, i) => {
              return (
                <CommandItem
                  key={i}
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
