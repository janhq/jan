import React, { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'

import './styles.scss'
import { twMerge } from 'tailwind-merge'

type Props = {
  trigger?: ReactNode
  content: ReactNode
  open?: boolean
  className?: string
  fullPage?: boolean
  hideClose?: boolean
  title?: ReactNode
  onOpenChange?: (open: boolean) => void
}

const ModalClose = DialogPrimitive.Close

const Modal = ({
  trigger,
  content,
  open,
  title,
  fullPage,
  className,
  onOpenChange,
  hideClose,
}: Props) => (
  <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="modal__overlay" />
      <DialogPrimitive.Content
        className={twMerge(
          'modal__content',
          fullPage && 'modal__content--fullpage',
          className
        )}
      >
        <div className="modal__title">{title}</div>
        {content}
        {!hideClose && (
          <ModalClose asChild>
            <button className="modal__close-icon" aria-label="Close">
              <Cross2Icon />
            </button>
          </ModalClose>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
)

export { Modal, ModalClose }
