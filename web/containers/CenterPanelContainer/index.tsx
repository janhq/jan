import { PropsWithChildren } from 'react'

import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

const CenterPanelContainer = ({ children }: PropsWithChildren) => {
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  return (
    <div
      className={twMerge('flex h-full w-full', !reduceTransparent && 'px-1.5')}
    >
      <div
        className={twMerge(
          'h-full w-full overflow-hidden bg-[hsla(var(--center-panel-bg))]',
          !reduceTransparent &&
            'rounded-lg border border-[hsla(var(--app-border))]'
        )}
      >
        {children}
      </div>
    </div>
  )
}

export default CenterPanelContainer
