import SimpleTag, { TagType } from "../SimpleTag";
import PrimaryButton from "../PrimaryButton";
import { formatDownloadPercentage, toGigabytes } from "@/_utils/converter";
import { DownloadState } from "@/_models/DownloadState";
import SecondaryButton from "../SecondaryButton";

type Props = {
  name: string;
  total: number;
  status: TagType;
  downloadState?: DownloadState;
  onDownloadClick?: () => void;
};

const ExploreModelItemHeader: React.FC<Props> = ({
  name,
  status,
  total,
  downloadState,
  onDownloadClick,
}) => (
  <div className="flex items-center justify-between p-4 border-b border-gray-200">
    <div className="flex items-center gap-2">
      <span>{name}</span>
      <SimpleTag title={status} type={status} clickable={false} />
    </div>
    {downloadState != null ? (
      <SecondaryButton
        disabled
        title={`Downloading (${formatDownloadPercentage(
          downloadState.percent
        )})`}
        onClick={() => {}}
      />
    ) : (
      <PrimaryButton
        title={total ? `Download (${toGigabytes(total)})` : "Download"}
        onClick={() => onDownloadClick?.()}
      />
    )}
  </div>
);

export default ExploreModelItemHeader;
