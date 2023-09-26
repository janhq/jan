import { Product } from "@/_models/Product";
import DownloadModelContent from "../DownloadModelContent";
import ViewModelDetailButton from "../ViewModelDetailButton";
import { executeSerial } from "@/_services/pluginService";
import { InfereceService } from "../../../shared/coreService";

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
}) => {
  const initModel = () => {
    executeSerial(InfereceService.INIT_MODEL, product)
      .then(() => console.info(`Init model success`))
      .catch((err) => console.log(`Init model error ${err}`));
  };

  const handleViewDetails = () => {};

  return (
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
        <div className="flex flex-col">
          <button onClick={initModel}>Init</button>
          <button onClick={() => onDeleteClick?.(product)}>Delete</button>
        </div>
      </div>
      <ViewModelDetailButton callback={handleViewDetails} />
    </div>
  );
};

export default DownloadedModelCard;
