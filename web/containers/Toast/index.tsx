import toast from 'react-hot-toast'

import { XIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

type Props = {
  title?: string
  description?: string
  type?: 'default' | 'error' | 'success' | 'warning'
}

const ErrorIcon = () => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20 10C20 15.5228 15.5228 20 10 20H0.993697C0.110179 20 -0.332289 18.9229 0.292453 18.2929L2.2495 16.3195C0.843343 14.597 1.21409e-08 12.397 1.21409e-08 10C1.21409e-08 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10ZM13.2071 6.79289C13.5976 7.18342 13.5976 7.81658 13.2071 8.20711L11.4142 10L13.2071 11.7929C13.5976 12.1834 13.5976 12.8166 13.2071 13.2071C12.8166 13.5976 12.1834 13.5976 11.7929 13.2071L10 11.4142L8.20711 13.2071C7.81658 13.5976 7.18342 13.5976 6.79289 13.2071C6.40237 12.8166 6.40237 12.1834 6.79289 11.7929L8.58579 10L6.79289 8.20711C6.40237 7.81658 6.40237 7.18342 6.79289 6.79289C7.18342 6.40237 7.81658 6.40237 8.20711 6.79289L10 8.58579L11.7929 6.79289C12.1834 6.40237 12.8166 6.40237 13.2071 6.79289Z"
        fill="#EA2E4E"
      />
    </svg>
  )
}

const WarningIcon = () => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20 10C20 15.5228 15.5228 20 10 20H0.993697C0.110179 20 -0.332289 18.9229 0.292453 18.2929L2.2495 16.3195C0.843343 14.597 1.21409e-08 12.397 1.21409e-08 10C1.21409e-08 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10ZM10.99 6C10.99 5.44772 10.5446 5 9.99502 5C9.44549 5 9 5.44772 9 6V10C9 10.5523 9.44549 11 9.99502 11C10.5446 11 10.99 10.5523 10.99 10V6ZM9.99502 13C9.44549 13 9 13.4477 9 14C9 14.5523 9.44549 15 9.99502 15H10.005C10.5545 15 11 14.5523 11 14C11 13.4477 10.5545 13 10.005 13H9.99502Z"
        fill="#FACC15"
      />
    </svg>
  )
}

const SuccessIcon = () => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20 10C20 15.5228 15.5228 20 10 20H0.993697C0.110179 20 -0.332289 18.9229 0.292453 18.2929L2.2495 16.3195C0.843343 14.597 1.21409e-08 12.397 1.21409e-08 10C1.21409e-08 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10ZM13.7071 8.70711C14.0976 8.31658 14.0976 7.68342 13.7071 7.29289C13.3166 6.90237 12.6834 6.90237 12.2929 7.29289L9 10.5858L7.70711 9.2929C7.31658 8.90237 6.68342 8.90237 6.29289 9.2929C5.90237 9.68342 5.90237 10.3166 6.29289 10.7071L8.29289 12.7071C8.48043 12.8946 8.73478 13 9 13C9.26522 13 9.51957 12.8946 9.70711 12.7071L13.7071 8.70711Z"
        fill="#34D399"
      />
    </svg>
  )
}

const DefaultIcon = () => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 20C15.5228 20 20 15.5228 20 10C20 4.47715 15.5228 0 10 0C4.47715 0 2.11188e-08 4.47715 2.11188e-08 10C2.11188e-08 12.397 0.843343 14.597 2.2495 16.3195L0.292453 18.2929C-0.332289 18.9229 0.110179 20 0.993697 20H10ZM5.5 8C5.5 7.44772 5.94772 7 6.5 7H13.5C14.0523 7 14.5 7.44772 14.5 8C14.5 8.55229 14.0523 9 13.5 9H6.5C5.94772 9 5.5 8.55229 5.5 8ZM6.5 11C5.94772 11 5.5 11.4477 5.5 12C5.5 12.5523 5.94772 13 6.5 13H9.5C10.0523 13 10.5 12.5523 10.5 12C10.5 11.4477 10.0523 11 9.5 11H6.5Z"
        fill="#60A5FA"
      />
    </svg>
  )
}

const renderIcon = (type: string) => {
  switch (type) {
    case 'warning':
      return <WarningIcon />

    case 'error':
      return <ErrorIcon />

    case 'success':
      return <SuccessIcon />

    default:
      return <DefaultIcon />
  }
}

export function toaster(props: Props) {
  const { title, description, type = 'default' } = props
  return toast.custom(
    (t) => {
      return (
        <div
          className={twMerge(
            'unset-drag relative flex animate-enter items-center gap-x-4 rounded-lg bg-foreground px-4 py-2 text-white',
            t.visible ? 'animate-enter' : 'animate-leave'
          )}
        >
          <div className="flex items-start gap-x-3">
            <div className="mt-1">{renderIcon(type)}</div>
            <div className="pr-4">
              <h1 className="font-bold">{title}</h1>
              <p>{description}</p>
            </div>
            <XIcon
              size={24}
              className="absolute right-2 top-2 w-4 cursor-pointer"
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
            'unset-drag relative bottom-2 flex animate-enter items-center gap-x-4 rounded-lg bg-foreground px-4 py-2 text-white',
            t.visible ? 'animate-enter' : 'animate-leave'
          )}
        >
          <div className="flex items-start gap-x-3">
            <div>{renderIcon(type)}</div>
            <p className="pr-4">{description}</p>
            <XIcon
              size={24}
              className="absolute right-2 top-1/2 w-4 -translate-y-1/2 cursor-pointer"
              onClick={() => toast.dismiss(t.id)}
            />
          </div>
        </div>
      )
    },
    { id: 'snackbar', duration: 2000, position: 'bottom-center' }
  )
}
