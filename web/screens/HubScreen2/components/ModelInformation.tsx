import React from 'react'

import { twMerge } from 'tailwind-merge'

import Spinner from '@/containers/Loader/Spinner'

import useGetReadMeContent from '@/hooks/useGetReadMeContent'

type Props = {
  modelHandle: string
  maxHeight: number
}

const ModelInformation: React.FC<Props> = ({ modelHandle, maxHeight }) => {
  const { data, isLoading } = useGetReadMeContent(modelHandle)
  if (isLoading)
    return (
      <div className="mb-4 mt-8 flex w-full justify-center">
        <Spinner />
      </div>
    )

  return (
    <div
      id="markdown"
      style={{ maxHeight }}
      className={twMerge(
        'mt-4 h-full w-full overflow-x-hidden text-sm leading-relaxed text-[hsla(var(--text-secondary))] [&_h2]:!mt-4 [&_h2]:!text-[hsla(var(--text-primary))]'
      )}
      dangerouslySetInnerHTML={{
        __html: data as string,
      }}
    />
  )
}

export default React.memo(ModelInformation)
