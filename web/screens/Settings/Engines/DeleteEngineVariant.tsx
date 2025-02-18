import { memo, useState } from 'react'

import { EngineReleased, InferenceEngine } from '@janhq/core'
import { Button, Modal, ModalClose } from '@janhq/joi'

import { Trash2Icon } from 'lucide-react'

import {
  uninstallEngine,
  useGetDefaultEngineVariant,
  useGetInstalledEngines,
} from '@/hooks/useEngineManagement'

const DeleteEngineVariant = ({
  variant,
  engine,
}: {
  variant: EngineReleased
  engine: InferenceEngine
}) => {
  const [open, setOpen] = useState(false)

  const { mutate: mutateInstalledEngines } = useGetInstalledEngines(engine)
  const { defaultEngineVariant } = useGetDefaultEngineVariant(engine)

  return (
    <Modal
      title={<span>Delete Variant</span>}
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
            Are you sure you want to delete {variant.name}? This action cannot
            be undone.
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
                  uninstallEngine(engine, {
                    variant: variant.name,
                    version: String(defaultEngineVariant?.version),
                  })
                  mutateInstalledEngines()
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

export default memo(DeleteEngineVariant)
