import { Product } from "@/_models/Product";
import DownloadModelContent from "../DownloadModelContent";
import ModelDownloadButton from "../ModelDownloadButton";
import ModelDownloadingButton from "../ModelDownloadingButton";
import { useAtomValue } from "jotai";
import { modelDownloadStateAtom } from "@/_helpers/atoms/DownloadState.atom";

type Props = {
  product: Product;
  isRecommend: boolean;
  required?: string;
  onDownloadClick?: (product: Product) => void;
};

const AvailableModelCard: React.FC<Props> = ({
  product,
  isRecommend,
  required,
  onDownloadClick,
}) => {
  const downloadState = useAtomValue(modelDownloadStateAtom);

  let isDownloading = false;
  let total = 0;
  let transferred = 0;

  if (product.fileName && downloadState[product.fileName]) {
    isDownloading =
      downloadState[product.fileName].error == null &&
      downloadState[product.fileName].percent < 1;

    if (isDownloading) {
      total = downloadState[product.fileName].size.total;
      transferred = downloadState[product.fileName].size.transferred;
    }
  }

  const downloadButton = isDownloading ? (
    <div className="w-1/5 flex items-start justify-end">
      <ModelDownloadingButton total={total} value={transferred} />
    </div>
  ) : (
    <div className="w-1/5 flex items-center justify-end">
      <ModelDownloadButton callback={() => onDownloadClick?.(product)} />
    </div>
  );

  return (
    <div className="border rounded-lg border-gray-200">
      <div className="flex justify-between py-4 px-3 gap-2.5">
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
      {/* <ViewModelDetailButton callback={handleViewDetails} /> */}
    </div>
  );
};

export default AvailableModelCard;
