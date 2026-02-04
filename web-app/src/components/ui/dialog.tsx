<<<<<<< HEAD
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
=======
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
<<<<<<< HEAD
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[80] bg-main-view/80 backdrop-blur-sm',
=======
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur",
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        className
      )}
      {...props}
    />
  )
}

<<<<<<< HEAD
type DialogContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  'showCloseButton'?: boolean
  'aria-describedby'?: string | undefined
}

function DialogContent({
  showCloseButton = true,
  className,
  children,
  'aria-describedby': ariaDescribedBy,
  ...props
}: DialogContentProps) {
  const { t } = useTranslation()
=======
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
<<<<<<< HEAD
        aria-describedby={ariaDescribedBy}
        className={cn(
          'bg-main-view max-h-[calc(100%-80px)] overflow-auto border-main-view-fg/10 text-main-view-fg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-[90] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
=======
        aria-describedby={undefined}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 outline-none sm:max-w-lg max-h-[85vh] overflow-y-auto",
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
<<<<<<< HEAD
          <DialogPrimitive.Close className="data-[state=open]:text-main-view-fg/50 absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-0 focus:outline-0 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer">
            <XIcon />
            <span className="sr-only">{t('close')}</span>
=======
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

<<<<<<< HEAD
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
=======
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      {...props}
    />
  )
}

<<<<<<< HEAD
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
=======
function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
<<<<<<< HEAD
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    />
=======
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end bg-background -mb-2",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
<<<<<<< HEAD
      className={cn('text-lg leading-none font-medium', className)}
=======
      className={cn("text-lg leading-none font-studio font-medium", className)}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
<<<<<<< HEAD
      className={cn('text-main-view-fg/80 text-sm', className)}
=======
      className={cn("text-muted-foreground text-sm", className)}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
