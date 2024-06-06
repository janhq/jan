import { useCallback, useLayoutEffect, memo, useState } from 'react'

import { Thread } from '@janhq/core'
import { Modal, ModalClose, Button, Input } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { PencilIcon } from 'lucide-react'

import { useDebouncedCallback } from 'use-debounce'

import useCortex from '@/hooks/useCortex'

import { updateThreadTitleAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  thread: Thread
  closeContextMenu?: () => void
}

const ModalEditTitleThread = ({ thread, closeContextMenu }: Props) => {
  const { updateThread } = useCortex()
  const updateThreadTitle = useSetAtom(updateThreadTitleAtom)
  const [title, setTitle] = useState(thread.title)

  useLayoutEffect(() => {
    if (thread.title) {
      setTitle(thread.title)
    }
  }, [thread.title])

  const debounceUpdateThreadTitle = useDebouncedCallback(
    async (title: string) => {
      updateThread({ ...thread, title })
    },
    500
  )

  const onUpdateTitle = useCallback(() => {
    updateThreadTitle(thread.id, title)
    debounceUpdateThreadTitle(title)
  }, [title, debounceUpdateThreadTitle, thread.id, updateThreadTitle])

  return (
    <Modal
      title="Edit title thread"
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
          <PencilIcon size={16} className="text-[hsla(var(--secondary))]" />
          <span className="text-bold text-[hsla(var(--secondary))]">
            Edit title
          </span>
        </div>
      }
      content={
        <form className="mt-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={(e) => e.stopPropagation()}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                type="submit"
                onClick={onUpdateTitle}
                disabled={title.length === 0}
              >
                Save
              </Button>
            </ModalClose>
          </div>
        </form>
      }
    />
  )
}

export default memo(ModalEditTitleThread)
