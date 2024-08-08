import { useCallback, memo } from 'react'

import { Thread } from '@janhq/core'
import { Button, Modal, ModalClose } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { Paintbrush } from 'lucide-react'

import { defaultThreadTitle } from '@/constants/Threads'

import useCortex from '@/hooks/useCortex'
import useThreads from '@/hooks/useThreads'

import { updateThreadTitleAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  thread: Thread
  closeContextMenu?: () => void
}

const ModalCleanThread = ({ thread, closeContextMenu }: Props) => {
  const { cleanThread } = useThreads()
  const updateThreadTitle = useSetAtom(updateThreadTitleAtom)
  const { updateThread } = useCortex()

  const onCleanThreadClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      cleanThread(thread.id)
      updateThreadTitle(thread.id, defaultThreadTitle)
      updateThread({ ...thread, title: defaultThreadTitle })
    },
    [cleanThread, thread, updateThread, updateThreadTitle]
  )

  return (
    <Modal
      title="Clean Thread"
      onOpenChange={(open) => {
        if (open && closeContextMenu) {
          closeContextMenu()
        }
      }}
      trigger={
        <div
          className="flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
          onClick={(e) => e.stopPropagation()}
        >
          <Paintbrush
            size={16}
            className="text-[hsla(var(--text-secondary))]"
          />
          <span className="text-bold text-[hsla(var(--app-text-primary))]">
            Clean thread
          </span>
        </div>
      }
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to clean this thread?
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button theme="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                theme="destructive"
                onClick={onCleanThreadClick}
                autoFocus
              >
                Yes
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default memo(ModalCleanThread)
