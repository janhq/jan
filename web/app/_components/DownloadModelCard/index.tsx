"use client";

import { Product } from "@/_models/Product";
import DownloadModelContent from "../DownloadModelContent";
import ModelDownloadButton from "../ModelDownloadButton";
import ModelDownloadingButton from "../ModelDownloadingButton";
import ViewModelDetailButton from "../ViewModelDetailButton";

type Props = {
  product: Product;
  isRecommend: boolean;
  installed?: boolean;
  required?: string;
  downloading?: boolean;
  total?: number;
  transferred?: number;
  onInitClick?: (product: Product) => void;
  onDeleteClick?: (product: Product) => void;
  onDownloadClick?: (product: Product) => void;
};

const DownloadModelCard: React.FC<Props> = ({
  product,
  isRecommend,
  installed = false,
  required,
  downloading = false,
  total = 0,
  transferred = 0,
  onInitClick,
  onDeleteClick,
  onDownloadClick,
}) => {
  const handleViewDetails = () => {};

  let downloadButton = null;
  if (!installed) {
    downloadButton = downloading ? (
      <div className="w-1/5 flex items-center justify-end">
        <ModelDownloadButton callback={() => onDownloadClick?.(product)} />
      </div>
    ) : (
      <div className="w-1/5 flex items-start justify-end">
        <ModelDownloadingButton total={total} value={transferred} />
      </div>
    );
  } else {
    downloadButton = (
      <div className="flex flex-col">
        <button onClick={() => onInitClick?.(product)}>Init</button>
        <button onClick={() => onDeleteClick?.(product)}>Delete</button>
      </div>
    );
  }

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
        {downloadButton}
      </div>
      <ViewModelDetailButton callback={handleViewDetails} />
    </div>
  );
};

export default DownloadModelCard;
