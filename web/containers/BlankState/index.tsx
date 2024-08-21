import { ReactNode } from 'react'

import LogoMark from '@/containers/Brand/Logo/Mark'

type Props = {
  title: string
  description?: string
  action?: ReactNode
}

const BlankState = ({ title, description, action }: Props) => {
  return (
    <div className="mx-auto mt-10 flex h-full w-3/4 flex-col items-center justify-center text-center">
      <LogoMark className="mx-auto mb-4 animate-wave" width={32} height={32} />
      <h1 className="text-base font-semibold">{title}</h1>
      {description && (
        <p className="mt-1 text-[hsla(var(--text-secondary))]">{description}</p>
      )}
      {action && action}
    </div>
  )
}

export default BlankState
