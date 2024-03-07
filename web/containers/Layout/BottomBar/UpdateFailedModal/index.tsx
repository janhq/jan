import React from 'react'

import {
  Modal,
  ModalPortal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
} from '@janhq/uikit'
import { Share2Icon } from '@radix-ui/react-icons'
import { useAtom } from 'jotai'

import { updateVersionError } from '@/containers/Providers/Jotai'

const UpdatedFailedModal = () => {
  const [error, setError] = useAtom(updateVersionError)

  return (
    <Modal open={!!error} onOpenChange={() => setError(undefined)}>
      <ModalPortal />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Unable to Install Update</ModalTitle>
        </ModalHeader>
        <p className="text-muted-foreground">
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
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={() => setError(undefined)}>
              <Button themes="outline">Remind me later</Button>
            </ModalClose>
            <ModalClose
              asChild
              onClick={() => {
                window.open('https://github.com/janhq/jan#download', '_blank')
                setError(undefined)
              }}
            >
              <Button themes="primary" autoFocus>
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
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default UpdatedFailedModal
