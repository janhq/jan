import React from "react";
import useCreateConversation from "@/_hooks/useCreateConversation";
import Image from "next/image";
import { Product } from "@/_models/Product";

type Props = {
  product: Product;
};

const ShortcutItem: React.FC<Props> = ({ product }) => {
  const { requestCreateConvo } = useCreateConversation();

  return (
    <button
      className="flex items-center gap-2 mx-1 p-2"
      onClick={() => requestCreateConvo(product)}
    >
      {product.avatarUrl && (
        <Image
          width={36}
          height={36}
          src={product.avatarUrl}
          className="w-9 aspect-square rounded-full"
          alt=""
        />
      )}
      <span className="text-gray-900 dark:text-white font-normal text-sm">
        {product.name}
      </span>
    </button>
  );
};

export default React.memo(ShortcutItem);
