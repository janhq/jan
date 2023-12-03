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
  const ref = useClickOutside(() => setMore(false))

  return (
    <div
      className={twMerge(
        'flex w-full flex-col rounded-lg border border-border',
        show && 'border border-border'
      )}
    >
      <div
        className={twMerge(
          'relative flex items-center rounded-t-md bg-zinc-200 dark:bg-zinc-600/10',
          show && 'border-b border-border'
        )}
      >
        <button
          onClick={() => setShow(!show)}
          className="flex w-full flex-1 items-center space-x-2 px-3 py-2"
        >
          <ChevronDownIcon
            className={`h-5 w-5 flex-none text-gray-400 ${
              show && 'rotate-180'
            }`}
          />
          <span className="font-bold">{title}</span>
        </button>
        <div
          className="cursor-pointer bg-zinc-200 p-2 dark:bg-zinc-600/10"
          onClick={() => setMore(!more)}
        >
          <MoreVerticalIcon className="h-5 w-5" />
        </div>
        {more && (
          <div
            className="absolute right-0 top-8 z-20 w-52 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
            ref={ref}
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
      {show && <div className="flex flex-col gap-2 p-2">{children}</div>}
    </div>
  )
}
