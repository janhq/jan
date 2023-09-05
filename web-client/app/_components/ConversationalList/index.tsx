import ConversationalCard from "../ConversationalCard";
import Image from "next/image";
import { ProductDetailFragment } from "@/graphql";

type Props = {
  products: ProductDetailFragment[];
};

const ConversationalList: React.FC<Props> = ({ products }) => (
  <>
    <div className="flex items-center gap-3 mt-8 mb-2">
      <Image src={"/icons/messicon.svg"} width={24} height={24} alt="" />
      <span className="font-semibold text-gray-900 dark:text-white">
        Conversational
      </span>
    </div>
    <div className="mt-2 flex w-full gap-2 overflow-x-scroll scroll overflow-hidden">
      {products.map((item) => (
        <ConversationalCard key={item.name} product={item} />
      ))}
    </div>
  </>
);

export default ConversationalList;
