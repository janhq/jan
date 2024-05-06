import React from 'react'

import { Modal, ModalClose, Button } from '@janhq/joi'
import { Share2Icon } from '@radix-ui/react-icons'
import { useAtom } from 'jotai'

import { updateVersionError } from '@/containers/Providers/Jotai'

const UpdatedFailedModal = () => {
  const [error, setError] = useAtom(updateVersionError)

  return (
    <Modal
      open={!!error}
      onOpenChange={() => setError(undefined)}
      title="Unable to Install Update"
      content={
        <div>
          <p className="text-[hsla(var(--app-text-secondary)]">
            An error occurred while installing Jan{' '}
            <span className="font-medium text-foreground">{error}</span>. We
            appreciate your help with{' '}
            <a
              href="https://github.com/janhq/jan#download"
              target="_blank"
              className="font-medium text-foreground"
            >
              manual downloading and installation.
            </a>
          </p>
          <div className="flex gap-x-2">
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
                Download now{' '}
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
