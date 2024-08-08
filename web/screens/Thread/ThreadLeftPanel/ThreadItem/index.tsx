import { useCallback, useState } from 'react'

import { Thread } from '@janhq/core'
import { motion as m } from 'framer-motion'
import { useAtomValue, useSetAtom } from 'jotai'
import { MoreHorizontalIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import { defaultThreadTitle } from '@/constants/Threads'

import useThreads from '@/hooks/useThreads'

import ModalCleanThread from '../ModalCleanThread'
import ModalDeleteThread from '../ModalDeleteThread'
import ModalEditTitleThread from '../ModalEditTitleThread'

import TypingAnimated from '../TypingAnimated'

import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  getActiveThreadIdAtom,
  getThreadIdsShouldAnimateTitleAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  thread: Thread
}

const ThreadItem: React.FC<Props> = ({ thread }) => {
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const getThreadIdsShouldAnimateTitle = useAtomValue(
    getThreadIdsShouldAnimateTitleAtom
  )

  const setEditMessage = useSetAtom(editMessageAtom)
  const { setActiveThread } = useThreads()
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    thread?: Thread
  }>({
    visible: false,
    thread: undefined,
  })

  const onContextMenu = (event: React.MouseEvent, thread: Thread) => {
    event.preventDefault()
    setContextMenu({
      visible: true,
      thread,
    })
  }

  const closeContextMenu = () => {
    setContextMenu({
      visible: false,
      thread: undefined,
    })
  }

  const onThreadClicked = useCallback(
    (thread: Thread) => {
      setActiveThread(thread.id)
      setEditMessage('')
    },
    [setActiveThread, setEditMessage]
  )

  return (
    <m.div
      key={thread.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, height: '28px' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ ease: 'linear', duration: 0.2 }}
      layoutId={thread.id}
      className={twMerge(
        'group/message relative mt-1 flex h-[28px] cursor-pointer items-center justify-between rounded-lg pl-2 first:mt-0 hover:bg-[hsla(var(--left-panel-menu-hover))]',
        activeThreadId === thread.id &&
          'text-primary bg-[hsla(var(--left-panel-icon-active-bg))] font-medium'
      )}
      onClick={() => onThreadClicked(thread)}
      onContextMenu={(e) => onContextMenu(e, thread)}
      onMouseLeave={closeContextMenu}
    >
      <div className="relative z-10 break-all p-2">
        {getThreadIdsShouldAnimateTitle.includes(thread.id) ? (
          <TypingAnimated
            text={thread.title || defaultThreadTitle}
            speed={20}
          />
        ) : (
          <span className="line-clamp-1 group-hover/message:pr-6">
            {thread.title || defaultThreadTitle}
          </span>
        )}
      </div>
      <div
        className={twMerge(
          'absolute bottom-0 right-0 top-0 flex w-[42px] items-center justify-end rounded-r-md'
        )}
      >
        <div
          className={twMerge(
            `group/icon text-[hsla(var(--text-secondary)] invisible absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-md px-0.5 group-hover/message:visible`
          )}
        >
          <MoreHorizontalIcon size={18} />
          <div
            className={twMerge(
              'shadow-lg invisible absolute right-0 top-0 z-50 w-40 overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] group-hover/icon:visible',
              contextMenu.visible &&
                contextMenu.thread?.id === thread.id &&
                'visible'
            )}
          >
            <ModalEditTitleThread
              thread={thread}
              closeContextMenu={closeContextMenu}
            />
            <ModalCleanThread
              thread={thread}
              closeContextMenu={closeContextMenu}
            />
            <ModalDeleteThread
              id={thread.id}
              title={thread.title}
              closeContextMenu={closeContextMenu}
            />
          </div>
        </div>
      </div>
    </m.div>
  )
}

export default ThreadItem
