import { AssistantModel } from "@/_models/AssistantModel";
import ConversationalCard from "../ConversationalCard";
import { ChatBubbleBottomCenterTextIcon } from "@heroicons/react/24/outline";

type Props = {
  models: AssistantModel[];
};

const ConversationalList: React.FC<Props> = ({ models }) => (
  <>
    <div className="flex items-center gap-3 mt-8 mb-2">
      <ChatBubbleBottomCenterTextIcon width={24} height={24} className="ml-6" />
      <span className="font-semibold text-gray-900 dark:text-white">
        Conversational
      </span>
    </div>
    <div className="mt-2 pl-6 flex w-full gap-2 overflow-x-scroll scroll overflow-hidden">
      {models.map((item) => (
        <ConversationalCard key={item._id} model={item} />
      ))}
    </div>
  </>
);

export default ConversationalList;
