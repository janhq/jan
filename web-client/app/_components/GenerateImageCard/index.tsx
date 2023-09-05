import useCreateConversation from "@/_hooks/useCreateConversation";
import { ProductDetailFragment } from "@/graphql";
import { useCallback } from "react";

type Props = {
  product: ProductDetailFragment;
};

const GenerateImageCard: React.FC<Props> = ({ product }) => {
  const { name, image_url } = product;
  const { requestCreateConvo } = useCreateConversation();

  const onClick = useCallback(() => {
    requestCreateConvo(product);
  }, [product]);

  return (
    <button onClick={onClick} className="relative active:opacity-50 text-left">
      <img
        src={image_url ?? ""}
        alt=""
        className="w-full h-full rounded-[8px] bg-gray-200 group-hover:opacity-75 object-cover object-center"
      />
      <div className="absolute bottom-0 rounded-br-[8px] rounded-bl-[8px] bg-[rgba(0,0,0,0.5)] w-full p-3">
        <span className="text-white font-semibold">{name}</span>
      </div>
    </button>
  );
};

export default GenerateImageCard;
