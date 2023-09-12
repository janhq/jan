import ConversationalCard from "../ConversationalCard";
import Image from "next/image";
import { ProductDetailFragment } from "@/graphql";

type Props = {
  products: ProductDetailFragment[];
};

const ConversationalList: React.FC<Props> = ({ products }) => (
  <>
    <div className="flex items-center gap-3 mt-8 mb-2">
      <Image src={"/icons/messicon.svg"} width={20} height={20} alt="" />
      <p className="text-xl dark:text-white dark:text-white">
        Conversational
      </p>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {products.map((item) => (
        <ConversationalCard key={item.name} product={item} />
        
      ))}
    </div>
  </>
);

export default ConversationalList;
