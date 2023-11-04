'use client'

import * as React from 'react'
import * as ModalPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

const Modal = ModalPrimitive.Root

const ModalTrigger = ModalPrimitive.Trigger

const ModalPortal = ModalPrimitive.Portal

const ModalClose = ModalPrimitive.Close

const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof ModalPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof ModalPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <ModalPrimitive.Overlay
    ref={ref}
    className={twMerge(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 modal-backdrop',
      className
    )}
    {...props}
  />
))
ModalOverlay.displayName = ModalPrimitive.Overlay.displayName

const ModalContent = React.forwardRef<
  React.ElementRef<typeof ModalPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ModalPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <ModalPortal>
    <ModalOverlay />
    <ModalPrimitive.Content
      ref={ref}
      className={twMerge(
        'bg-data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] modal-content',
        className
      )}
      {...props}
    >
      {children}
      <ModalPrimitive.Close className="modal-close">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </ModalPrimitive.Close>
    </ModalPrimitive.Content>
  </ModalPortal>
))
ModalContent.displayName = ModalPrimitive.Content.displayName

const ModalHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={twMerge('modal-header', className)} {...props} />
)
ModalHeader.displayName = 'ModalHeader'

const ModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={twMerge('modal-footer', className)} {...props} />
)
ModalFooter.displayName = 'ModalFooter'

const ModalTitle = React.forwardRef<
  React.ElementRef<typeof ModalPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ModalPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ModalPrimitive.Title
    ref={ref}
    className={twMerge('modal-title', className)}
    {...props}
  />
))
ModalTitle.displayName = ModalPrimitive.Title.displayName

const ModalDescription = React.forwardRef<
  React.ElementRef<typeof ModalPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ModalPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ModalPrimitive.Description
    ref={ref}
    className={twMerge('modal-description', className)}
    {...props}
  />
))
ModalDescription.displayName = ModalPrimitive.Description.displayName

export {
  Modal,
  ModalPortal,
  ModalOverlay,
  ModalClose,
  ModalTrigger,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalTitle,
  ModalDescription,
}
