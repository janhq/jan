"use client";

import { useState } from "react";
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
}) => {
  const [download, setDownload] = useState(true);
  const handleClick = () => {
    setDownload(!download);
  };
  const handleViewDetails = () => {};

  let downloadButton = null;
  if (!installed) {
    downloadButton = download ? (
      <div className="w-1/5 flex items-center justify-end">
        <ModelDownloadButton callback={handleClick} />
      </div>
    ) : (
      <div className="w-1/5 flex items-start justify-end">
        <ModelDownloadingButton total={storage} value={128} />
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
