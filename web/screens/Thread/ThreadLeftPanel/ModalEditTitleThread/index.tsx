import { useCallback, useLayoutEffect, memo, useState } from 'react'

import { Modal, ModalClose, Button, Input } from '@janhq/joi'
import { useAtom } from 'jotai'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import {
  modalActionThreadAtom,
  ThreadModalAction,
} from '@/helpers/atoms/Thread.atom'

const ModalEditTitleThread = () => {
  const { updateThreadMetadata } = useCreateNewThread()
  const [modalActionThread, setModalActionThread] = useAtom(
    modalActionThreadAtom
  )
  const [title, setTitle] = useState(
    modalActionThread.thread?.metadata?.title as string
  )

  useLayoutEffect(() => {
    if (modalActionThread.thread?.metadata?.title) {
      setTitle(modalActionThread.thread?.metadata?.title as string)
    }
  }, [modalActionThread.thread?.metadata])

  const onUpdateTitle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      e.stopPropagation()
      if (!modalActionThread.thread) return null
      updateThreadMetadata({
        ...modalActionThread?.thread,
        title: title || 'New Thread',
        metadata: {
          ...modalActionThread?.thread.metadata,
          title: title || 'New Thread',
        },
      })
    },
    [modalActionThread?.thread, title, updateThreadMetadata]
  )

  const onCloseModal = useCallback(() => {
    setModalActionThread({
      showModal: undefined,
      thread: undefined,
    })
  }, [setModalActionThread])

  return (
    <Modal
      title="Edit title thread"
      onOpenChange={onCloseModal}
      open={modalActionThread.showModal === ThreadModalAction.EditTitle}
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
              <Button type="submit" onClick={onUpdateTitle} disabled={!title}>
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
