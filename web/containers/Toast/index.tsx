import toast from 'react-hot-toast'

import {
  XIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertCircleIcon,
  InfoIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

type Props = {
  title?: string
  description?: string
  type?: 'default' | 'error' | 'success' | 'warning'
}

const renderIcon = (type: string) => {
  switch (type) {
    case 'warning':
      return (
        <AlertCircleIcon size={18} className="text-[hsla(var(--warning-bg))]" />
      )

    case 'error':
      return (
        <XCircleIcon size={18} className="text-[hsla(var(--destructive-bg))]" />
      )

    case 'success':
      return (
        <CheckCircleIcon size={18} className="text-[hsla(var(--success-bg))]" />
      )

    default:
      return <InfoIcon size={18} className="text-[hsla(var(--info-bg))]" />
  }
}

export function toaster(props: Props) {
  const { title, description, type = 'default' } = props
  return toast.custom(
    (t) => {
      return (
        <div
          className={twMerge(
            'unset-drag relative bottom-2 flex w-80 animate-enter items-center gap-x-4 rounded-lg bg-[hsla(var(--toaster-bg))] p-3',
            t.visible ? 'animate-enter' : 'animate-leave'
          )}
        >
          <div className="relative flex w-full items-start gap-x-3">
            <div className="mt-1">{renderIcon(type)}</div>
            <div>
              <h1 className="font-medium text-[hsla(var(--toaster-text-title))]">
                {title}
              </h1>
              <p className="mt-1 text-[hsla(var(--toaster-text-desc))]">
                {description}
              </p>
            </div>
            <XIcon
              size={24}
              className="absolute -top-1 right-1 w-4 cursor-pointer text-[hsla(var(--toaster-close-icon))]"
              onClick={() => toast.dismiss(t.id)}
            />
          </div>
        </div>
      )
    },
    { id: 'toast', duration: 2000, position: 'top-right' }
  )
}

export function snackbar(props: Props) {
  const { description, type = 'default' } = props
  return toast.custom(
    (t) => {
      return (
        <div
          className={twMerge(
            'unset-drag relative bottom-2 flex w-80 animate-enter items-center gap-x-4 rounded-lg bg-[hsla(var(--toaster-bg))] p-3',
            t.visible ? 'animate-enter' : 'animate-leave'
          )}
        >
          <div className="flex w-full items-start gap-x-3">
            <div>{renderIcon(type)}</div>
            <p className="pr-3 text-[hsla(var(--toaster-text-desc))]">
              {description}
            </p>
            <XIcon
              size={24}
              className="absolute right-2 top-4 w-4 -translate-y-1/2 cursor-pointer text-[hsla(var(--toaster-close-icon))]"
              onClick={() => toast.dismiss(t.id)}
            />
          </div>
        </div>
      )
    },
    { id: 'snackbar', duration: 2000, position: 'bottom-center' }
  )
}
