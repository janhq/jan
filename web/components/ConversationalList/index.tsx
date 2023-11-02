import { Model } from '@janhq/core/lib/types'
import { ChatBubbleBottomCenterTextIcon } from '@heroicons/react/24/outline'

import ConversationalCard from '../ConversationalCard'

type Props = {
  models: Model[]
}

const ConversationalList: React.FC<Props> = ({ models }) => (
  <>
    <div className="mb-2 mt-8 flex items-center gap-3">
      <ChatBubbleBottomCenterTextIcon width={24} height={24} className="ml-6" />
      <span className="font-semibold text-gray-900 dark:text-white">
        Conversational
      </span>
    </div>
    <div className="scroll mt-2 flex w-full gap-2 overflow-hidden overflow-x-scroll pl-6">
      {models?.map((item) => (
        <ConversationalCard key={item._id} model={item} />
      ))}
    </div>
  </>
)

export default ConversationalList
