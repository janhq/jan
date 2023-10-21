import React from 'react'
import Image from 'next/image'
import useCreateConversation from '@hooks/useCreateConversation'
import { AssistantModel } from '@models/AssistantModel'
import { PlayIcon } from '@heroicons/react/24/outline'

type Props = {
  model: AssistantModel
}

const ConversationalCard: React.FC<Props> = ({ model }) => {
  const { requestCreateConvo } = useCreateConversation()

  const { name, avatarUrl, shortDescription } = model

  return (
    <button
      onClick={() => requestCreateConvo(model)}
      className="flex w-52 flex-shrink-0 flex-col justify-between gap-3 rounded-lg bg-white p-4 text-left hover:opacity-20 dark:bg-gray-700"
    >
      <div className="box-border flex flex-col gap-2">
        <Image
          width={32}
          height={32}
          src={avatarUrl ?? ''}
          className="rounded-full"
          alt=""
        />
        <h2 className="mt-2 line-clamp-1 font-semibold text-gray-900 dark:text-white">
          {name}
        </h2>
        <span className="mt-1 line-clamp-2 font-normal text-gray-600">
          {shortDescription}
        </span>
      </div>
      <span className="flex items-center gap-0.5 text-xs leading-5 text-gray-500">
        <PlayIcon width={16} height={16} />
        32.2k runs
      </span>
    </button>
  )
}

export default React.memo(ConversationalCard)
