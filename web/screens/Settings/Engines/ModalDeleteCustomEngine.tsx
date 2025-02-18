import { memo, useState } from 'react'

import { InferenceEngine } from '@janhq/core'
import { Button, Modal, ModalClose } from '@janhq/joi'

import { Trash2Icon } from 'lucide-react'

import { uninstallEngine } from '@/hooks/useEngineManagement'

const ModalDeleteCustomEngine = ({ engine }: { engine: InferenceEngine }) => {
  const [open, setOpen] = useState(false)

  return (
    <Modal
      title={<span>Delete Engine</span>}
      open={open}
      onOpenChange={() => setOpen(!open)}
      trigger={
        <Button theme="icon" variant="outline" onClick={() => setOpen(!open)}>
          <Trash2Icon
            size={14}
            className="text-[hsla(var(--text-secondary))]"
          />
        </Button>
      }
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to delete {engine}? This action cannot be
            undone.
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose
              asChild
              onClick={(e) => {
                setOpen(!open)
                e.stopPropagation()
              }}
            >
              <Button theme="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                theme="destructive"
                onClick={() => {
                  uninstallEngine(engine, {})
                }}
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

export default memo(ModalDeleteCustomEngine)
