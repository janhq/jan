import DownloadModelContent from "../DownloadModelContent";
import ModelDownloadButton from "../ModelDownloadButton";
import ModelDownloadingButton from "../ModelDownloadingButton";
import { useAtomValue } from "jotai";
import { modelDownloadStateAtom } from "@/_helpers/atoms/DownloadState.atom";
import { AssistantModel } from "@/_models/AssistantModel";

type Props = {
  model: AssistantModel;
  isRecommend: boolean;
  required?: string;
  onDownloadClick?: (model: AssistantModel) => void;
};

const AvailableModelCard: React.FC<Props> = ({
  model,
  isRecommend,
  required,
  onDownloadClick,
}) => {
  const downloadState = useAtomValue(modelDownloadStateAtom);

  let isDownloading = false;
  let total = 0;
  let transferred = 0;

  if (model.id && downloadState[model.id]) {
    isDownloading =
      downloadState[model.id].error == null &&
      downloadState[model.id].percent < 1;

    if (isDownloading) {
      total = downloadState[model.id].size.total;
      transferred = downloadState[model.id].size.transferred;
    }
  }

  const downloadButton = isDownloading ? (
    <div className="w-1/5 flex items-start justify-end">
      <ModelDownloadingButton total={total} value={transferred} />
    </div>
  ) : (
    <div className="w-1/5 flex items-center justify-end">
      <ModelDownloadButton callback={() => onDownloadClick?.(model)} />
    </div>
  );

  return (
    <div className="border rounded-lg border-gray-200">
      <div className="flex justify-between py-4 px-3 gap-2.5">
        <DownloadModelContent
          required={required}
          author={model.author}
          description={model.shortDescription}
          isRecommend={isRecommend}
          name={model.name}
          type={model.type}
        />
        {downloadButton}
      </div>
      {/* <ViewModelDetailButton callback={handleViewDetails} /> */}
    </div>
  );
};

export default AvailableModelCard;
