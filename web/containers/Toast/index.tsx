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
            t.visible ? 'animate-enter' : 'animate-leave'
          )}
        >
          <h1 className="capitalize">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
      )
    },
    { id: 'toast', duration: 3000 }
  )
}
