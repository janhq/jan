import { ReactNode, useState } from 'react'

import { useAtomValue } from 'jotai'
import {
  ChevronDownIcon,
  MoreVerticalIcon,
  FolderOpenIcon,
  Code2Icon,
  PencilIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useClickOutside } from '@/hooks/useClickOutside'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

interface Props {
  children: ReactNode
  title: string
  onRevealInFinderClick?: (type: string) => void
  onViewJsonClick?: (type: string) => void
  asChild?: boolean
}
export default function CardSidebar({
  children,
  title,
  onRevealInFinderClick,
  onViewJsonClick,
  asChild,
}: Props) {
  const [show, setShow] = useState(true)
  const [more, setMore] = useState(false)
  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  const { activeModel } = useActiveModel()
  const activeThread = useAtomValue(activeThreadAtom)

  useClickOutside(() => setMore(false), null, [menu, toggle])

  let openFolderTitle: string = 'Open Containing Folder'
  if (isMac) {
    openFolderTitle = 'Reveal in Finder'
  } else if (isWindows) {
    openFolderTitle = 'Reveal in File Explorer'
  }

  return (
    <div
      className={twMerge(
        'flex w-full flex-col border-t border-border bg-zinc-100 dark:bg-zinc-900',
        asChild ? 'rounded-lg border' : 'border-t'
      )}
    >
      <div
        className={twMerge(
          'relative flex items-center justify-between pl-4',
          show && 'border-b border-border'
        )}
      >
        <span className="font-bold">{title}</span>
        <div className="flex">
          {!asChild && (
            <div
              ref={setToggle}
              className="cursor-pointer rounded-lg bg-zinc-100 p-2 pr-0 dark:bg-zinc-900"
              onClick={() => setMore(!more)}
            >
              <MoreVerticalIcon className="h-5 w-5" />
            </div>
          )}
          <button
            onClick={() => setShow(!show)}
            className="flex w-full flex-1 items-center space-x-2 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900"
          >
            <ChevronDownIcon
              className={twMerge(
                'h-5 w-5 flex-none text-gray-400',
                show && 'rotate-180'
              )}
            />
          </button>
        </div>

        {more && (
          <div
            className="absolute right-4 top-8 z-20 w-72 rounded-lg border border-border bg-background shadow-lg"
            ref={setMenu}
          >
            <div
              className={twMerge(
                'flex cursor-pointer space-x-2 px-4 py-2 hover:bg-secondary',
                title === 'Model' ? 'items-start' : 'items-center'
              )}
              onClick={() => {
                onRevealInFinderClick && onRevealInFinderClick(title)
                setMore(false)
              }}
            >
              <FolderOpenIcon
                size={16}
                className={twMerge(
                  'flex-shrink-0 text-muted-foreground',
                  title === 'Model' && 'mt-1'
                )}
              />
              <>
                {title === 'Model' ? (
                  <div className="flex flex-col">
                    <span className="font-medium text-black dark:text-muted-foreground">
                      Show in Finder
                    </span>
                    <span className="mt-1 text-muted-foreground">
                      Opens thread.json. Changes affect this thread only.
                    </span>
                  </div>
                ) : (
                  <span className="text-bold text-black dark:text-muted-foreground">
                    Show in Finder
                  </span>
                )}
              </>
            </div>
            <div
              className="flex cursor-pointer items-start space-x-2 px-4 py-2 hover:bg-secondary"
              onClick={() => {
                onViewJsonClick && onViewJsonClick(title)
                setMore(false)
              }}
            >
              <PencilIcon
                size={16}
                className="mt-0.5 flex-shrink-0 text-muted-foreground"
              />
              <>
                <div className="flex flex-col">
                  <span className="line-clamp-1 font-medium text-black dark:text-muted-foreground">
                    Edit Global Defaults for{' '}
                    <span
                      className="font-bold"
                      title={activeThread?.assistants[0].model.id}
                    >
                      {activeThread?.assistants[0].model.id}
                    </span>
                  </span>
                  <span className="mt-1 text-muted-foreground">
                    {title === 'Model' ? (
                      <>
                        Opens <span className="lowercase">{title}.json.</span>
                        &nbsp;Changes affect all new assistants and threads.
                      </>
                    ) : (
                      <>
                        Opens <span className="lowercase">{title}.json.</span>
                        &nbsp;Changes affect all new threads.
                      </>
                    )}
                  </span>
                </div>
              </>
            </div>
          </div>
        )}
      </div>
      {show && (
        <div
          className={twMerge(
            'flex flex-col gap-2 bg-white px-2 dark:bg-background',
            asChild && 'rounded-b-lg'
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
