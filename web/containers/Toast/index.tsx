import toast from 'react-hot-toast'

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
            'pointer-events-auto flex min-w-[200px] max-w-[350px] flex-col rounded-lg border border-border bg-background px-4 py-2',
            t.visible ? 'animate-enter' : 'animate-leave',
            type === 'success' && 'bg-primary text-primary-foreground'
          )}
        >
          <h1
            className={twMerge(
              'capitalize',
              type === 'success' && 'font-medium text-primary-foreground'
            )}
          >
            {title}
          </h1>
          <p
            className={twMerge(
              'text-muted-foreground',
              type === 'success' && 'text-primary-foreground/80'
            )}
          >
            {description}
          </p>
        </div>
      )
    },
    { id: 'toast', duration: 6000 }
  )
}
