import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'
import { Share2Icon } from '@radix-ui/react-icons'
import { useAtom } from 'jotai'

import { updateVersionErrorAtom } from '@/helpers/atoms/App.atom'

const UpdatedFailedModal = () => {
  const [error, setError] = useAtom(updateVersionErrorAtom)

  return (
    <Modal
      open={!!error}
      onOpenChange={() => setError(undefined)}
      title="Unable to Install Update"
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary)]">
            An error occurred while installing Jan{' '}
            <span className="font-medium">{error}</span>. We appreciate your
            help with{' '}
            <a
              href="https://github.com/janhq/jan#download"
              target="_blank"
              className="font-medium text-[hsla(var(--text-link))]"
            >
              manual downloading and installation.
            </a>
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={() => setError(undefined)}>
              <Button theme="ghost">Remind me later</Button>
            </ModalClose>
            <ModalClose
              asChild
              onClick={() => {
                window.open('https://github.com/janhq/jan#download', '_blank')
                setError(undefined)
              }}
            >
              <Button autoFocus>
                Download now
                <Share2Icon
                  width={16}
                  height={16}
                  className="ml-2"
                  color="white"
                />
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default UpdatedFailedModal
