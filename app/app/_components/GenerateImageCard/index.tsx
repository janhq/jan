import useCreateConversation from "@/_hooks/useCreateConversation";
import { Product } from "@/_models/Product";

type Props = {
  product: Product;
};

const GenerateImageCard: React.FC<Props> = ({ product }) => {
  const { name, avatarUrl } = product;
  const { requestCreateConvo } = useCreateConversation();

  return (
    <button
      onClick={() => requestCreateConvo(1)}
      className="relative active:opacity-50 text-left"
    >
      <img
        src={avatarUrl}
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
