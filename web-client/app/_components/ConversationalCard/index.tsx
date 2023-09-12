import React from "react";
import Image from "next/image";
import {
  ProductDetailFragment,
} from "@/graphql";
import useCreateConversation from "@/_hooks/useCreateConversation";

type Props = {
  product: ProductDetailFragment;
};

const ConversationalCard: React.FC<Props> = ({ product }) => {
  const { requestCreateConvo } = useCreateConversation();

  const { name, image_url, description } = product;

  return (
    <button
      onClick={() =>
        requestCreateConvo(product)
      }
      className="relative flex items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 hover:border-gray-400"
        >
      <div className="flex-shrink-0">
        <Image
          width={32}
          height={32}
          src={image_url ?? ""}
          className="rounded-full"
          alt=""
        />
        </div>
        <div className="min-w-0 flex-1">
        <p className="text-left text-sm font-medium text-gray-900">
          {name}
        </p>
        <p className="text-left text-sm text-gray-500 line-clamp-2">
          {description}
        </p>
      </div>
    </button>
  );
};

export default React.memo(ConversationalCard);
