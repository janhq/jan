import toast from 'react-hot-toast'

import { XIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

type Props = {
  title?: string
  description?: string
  type?: 'default' | 'error' | 'success'
}

export function toaster(props: Props) {
  const { title, description, type = 'default' } = props
  return toast.custom(
    (t) => {
      return (
        <div
          className={twMerge(
            'unset-drag relative flex min-w-[200px] max-w-[350px] gap-x-4 rounded-lg border border-border bg-background px-4 py-3',
            t.visible ? 'animate-enter' : 'animate-leave',
            type === 'success' && 'bg-primary text-primary-foreground'
          )}
        >
          <div>
            <h1
              className={twMerge(
                'font-medium',
                type === 'success' && 'font-medium text-primary-foreground'
              )}
            >
              {title}
            </h1>
            <p
              className={twMerge(
                'mt-1 text-muted-foreground',
                type === 'success' && 'text-primary-foreground/80'
              )}
            >
              {description}
            </p>
          </div>
          <XIcon
            size={24}
            className="absolute right-2 top-2 w-4 cursor-pointer text-muted-foreground"
            onClick={() => toast.dismiss(t.id)}
          />
        </div>
      )
    },
    { id: 'toast', duration: 3000 }
  )
}
