import React from 'react'

import { twMerge } from 'tailwind-merge'

import useGetReadMeContent from '@/hooks/useGetReadMeContent'

type Props = {
  modelHandle: string
  maxHeight: number
}

const ModelInformation: React.FC<Props> = ({ modelHandle, maxHeight }) => {
  const { data } = useGetReadMeContent(modelHandle)
  if (!data) return null
  return (
    <div
      id="markdown"
      style={{ maxHeight }}
      className={twMerge(
        'mt-4 h-full w-full overflow-x-hidden text-sm leading-relaxed text-[hsla(var(--text-secondary))] [&_h2]:!mt-4 [&_h2]:!text-[hsla(var(--text-primary))]'
      )}
      dangerouslySetInnerHTML={{
        __html: data,
      }}
    />
  )
}

export default React.memo(ModelInformation)
