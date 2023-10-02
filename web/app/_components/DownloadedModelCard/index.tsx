import { Product } from "@/_models/Product";
import DownloadModelContent from "../DownloadModelContent";

type Props = {
  product: Product;
  isRecommend: boolean;
  required?: string;
  transferred?: number;
  onDeleteClick?: (product: Product) => void;
};

const DownloadedModelCard: React.FC<Props> = ({
  product,
  isRecommend,
  required,
  onDeleteClick,
}) => (
  <div className="border rounded-lg border-gray-200">
    <div className="flex justify-between py-4 px-3 gap-[10px]">
      <DownloadModelContent
        required={required}
        author={product.author}
        description={product.description}
        isRecommend={isRecommend}
        name={product.name}
        type={product.type}
      />
      <div className="flex flex-col justify-center">
        <button onClick={() => onDeleteClick?.(product)}>Delete</button>
      </div>
    </div>
  </div>
);

export default DownloadedModelCard;
