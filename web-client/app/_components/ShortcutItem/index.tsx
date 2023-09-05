import React from "react";
import useCreateConversation from "@/_hooks/useCreateConversation";
import { ProductDetailFragment } from "@/graphql";

type Props = {
  product: ProductDetailFragment;
};

const ShortcutItem: React.FC<Props> = ({ product }) => {
  const { requestCreateConvo } = useCreateConversation();

  const onClickHandler = () => {
    requestCreateConvo(product);
  };

  return (
    <button className="flex items-center gap-2" onClick={onClickHandler}>
      {product.image_url && (
        <img
          src={product.image_url}
          className="w-9 aspect-square rounded-full"
          alt=""
        />
      )}
      <div className="flex flex-col text-sm leading-[20px]">
        <span className="text-[#111928] dark:text-white">{product.name}</span>
      </div>
    </button>
  );
};

export default React.memo(ShortcutItem);
