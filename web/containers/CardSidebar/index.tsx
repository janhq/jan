import { ReactNode, useState } from 'react'

import {
  ChevronDownIcon,
  MoreVerticalIcon,
  FolderOpenIcon,
  Code2Icon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import { useClickOutside } from '@/hooks/useClickOutside'

interface Props {
  children: ReactNode
  title: string
  onRevealInFinderClick: (type: string) => void
  onViewJsonClick: (type: string) => void
}
export default function CardSidebar({
  children,
  title,
  onRevealInFinderClick,
  onViewJsonClick,
}: Props) {
  const [show, setShow] = useState(true)
  const [more, setMore] = useState(false)
  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)

  useClickOutside(() => setMore(false), null, [menu, toggle])

  return (
    <div
      className={twMerge(
        'flex w-full flex-col overflow-hidden rounded-md border border-border bg-zinc-200 dark:bg-zinc-600/10'
      )}
    >
      <div
        className={twMerge(
          'relative flex items-center rounded-t-md ',
          show && 'border-b border-border'
        )}
      >
        <button
          onClick={() => setShow(!show)}
          className="flex w-full flex-1 items-center space-x-2 bg-zinc-200 px-3 py-2 dark:bg-zinc-600/10"
        >
          <ChevronDownIcon
            className={twMerge(
              'h-5 w-5 flex-none text-gray-400',
              show && 'rotate-180'
            )}
          />
          <span className="font-bold">{title}</span>
        </button>
        <div
          ref={setToggle}
          className="cursor-pointer rounded-md bg-zinc-200 p-2 dark:bg-zinc-600/10"
          onClick={() => setMore(!more)}
        >
          <MoreVerticalIcon className="h-5 w-5" />
        </div>
        {more && (
          <div
            className="absolute right-0 top-8 z-20 w-52 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
            ref={setMenu}
          >
            <div
              className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary"
              onClick={() => {
                onRevealInFinderClick(title)
                setMore(false)
              }}
            >
              <FolderOpenIcon size={16} className="text-muted-foreground" />
              <span className="text-bold text-black dark:text-muted-foreground">
                Reveal in Finder
              </span>
            </div>
            <div
              className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary"
              onClick={() => {
                onViewJsonClick(title)
                setMore(false)
              }}
            >
              <Code2Icon size={16} className="text-muted-foreground" />
              <span className="text-bold text-black dark:text-muted-foreground">
                View as JSON
              </span>
            </div>
          </div>
        )}
      </div>
      {show && (
        <div className="flex flex-col gap-2 bg-white p-2 dark:bg-background">
          {children}
        </div>
      )}
    </div>
  )
}
