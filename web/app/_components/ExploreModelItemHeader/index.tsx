import SimpleTag, { TagType } from "../SimpleTag";
import PrimaryButton from "../PrimaryButton";
import { formatDownloadPercentage, toGigabytes } from "@/_utils/converter";
import { DownloadState } from "@/_models/DownloadState";
import SecondaryButton from "../SecondaryButton";
import { ModelVersion } from "@/_models/Product";

type Props = {
  name: string;
  status: TagType;
  versions: ModelVersion[];
  size?: number;
  downloadState?: DownloadState;
  onDownloadClick?: () => void;
};

const ExploreModelItemHeader: React.FC<Props> = ({
  name,
  status,
  size,
  versions,
  downloadState,
  onDownloadClick,
}) => {
  let downloadButton = (
    <PrimaryButton
      title={size ? `Download (${toGigabytes(size)})` : "Download"}
      onClick={() => onDownloadClick?.()}
    />
  );

  if (downloadState != null) {
    // downloading
    downloadButton = (
      <SecondaryButton
        disabled
        title={`Downloading (${formatDownloadPercentage(
          downloadState.percent
        )})`}
      />
    );
  } else if (versions.length === 0) {
    downloadButton = <SecondaryButton disabled title="No files available" />;
  }

  return (
    <div className="flex items-center justify-between p-4 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <span>{name}</span>
        <SimpleTag title={status} type={status} clickable={false} />
      </div>
      {downloadButton}
    </div>
  );
};

export default ExploreModelItemHeader;
