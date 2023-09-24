"use client";

import DownloadModelContent from "../DownloadModelContent";
import ModelDownloadButton from "../ModelDownloadButton";
import ModelDownloadingButton from "../ModelDownloadingButton";
import ViewModelDetailButton from "../ViewModelDetailButton";

type Props = {
  name: string;
  type: string;
  author: string;
  description: string;
  isRecommend: boolean;
  storage: number;
  installed?: boolean;
  required?: string;
  downloading?: boolean;
  total?: number;
  transferred?: number;
  onInitClick?: () => void;
  onDeleteClick?: () => void;
  onDownloadClick?: () => void;
};

const DownloadModelCard: React.FC<Props> = ({
  author,
  description,
  isRecommend,
  name,
  storage,
  type,
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
        <ModelDownloadButton callback={() => onDownloadClick?.()} />
      </div>
    ) : (
      <div className="w-1/5 flex items-start justify-end">
        <ModelDownloadingButton total={total} value={transferred} />
      </div>
    );
  } else {
    downloadButton = (
      <div className="flex flex-col">
        <button onClick={onInitClick}>Init</button>
        <button onClick={onDeleteClick}>Delete</button>
      </div>
    );
  }

  return (
    <div className="border rounded-lg border-gray-200">
      <div className="flex justify-between py-4 px-3 gap-[10px]">
        <DownloadModelContent
          required={required}
          author={author}
          description={description}
          isRecommend={isRecommend}
          name={name}
          type={type}
        />
        {downloadButton}
      </div>
      <ViewModelDetailButton callback={handleViewDetails} />
    </div>
  );
};

export default DownloadModelCard;
