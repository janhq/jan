import React from "react";
import Image from "next/image";
import useCreateConversation from "@/_hooks/useCreateConversation";
import { Product } from "@/_models/Product";

type Props = {
  product: Product;
};

const ConversationalCard: React.FC<Props> = ({ product }) => {
  const { requestCreateConvo } = useCreateConversation();

  const { name, avatarUrl, description } = product;

  return (
    <button
      onClick={() => requestCreateConvo(product)}
      className="flex flex-col justify-between flex-shrink-0 gap-3 bg-white p-4 w-52 rounded-lg text-left dark:bg-gray-700 hover:opacity-20"
    >
      <div className="flex flex-col gap-2 box-border">
        <Image
          width={32}
          height={32}
          src={avatarUrl ?? ""}
          className="rounded-full"
          alt=""
        />
        <h2 className="text-gray-900 font-semibold dark:text-white line-clamp-1 mt-2">
          {name}
        </h2>
        <span className="text-gray-600 mt-1 font-normal line-clamp-2">
          {description}
        </span>
      </div>
      <span className="flex text-xs leading-5 text-gray-500 items-center gap-0.5">
        <Image src={"icons/play.svg"} width={16} height={16} alt="" />
        32.2k runs
      </span>
    </button>
  );
};

export default React.memo(ConversationalCard);
