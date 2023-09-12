import { Product } from "@/_models/Product";
import ConversationalCard from "../ConversationalCard";
import { ChatBubbleBottomCenterTextIcon } from "@heroicons/react/24/outline";

type Props = {
  products: Product[];
};

const ConversationalList: React.FC<Props> = ({ products }) => (
  <>
    <div className="flex items-center gap-3 mt-8 mb-2">
      <ChatBubbleBottomCenterTextIcon width={24} height={24} className="ml-6" />
      <span className="font-semibold text-gray-900 dark:text-white">
        Conversational
      </span>
    </div>
    <div className="mt-2 pl-6 flex w-full gap-2 overflow-x-scroll scroll overflow-hidden">
      {products.map((item) => (
        <ConversationalCard key={item.slug} product={item} />
      ))}
    </div>
  </>
);

export default ConversationalList;
