import { toGigabytes } from "@/_utils/converter";

type Props = {
  total: number;
  value: number;
};

const ModelDownloadingButton: React.FC<Props> = ({ total, value }) => {
  return (
    <div className="flex flex-col gap-1">
      <button className="py-2 px-3 flex gap-2 border text-xs leading-[18px] border-gray-200 rounded-lg">
        Downloading...
      </button>
      <div className="py-0.5 px-2.5 bg-gray-200 rounded">
        <span className="text-xs font-medium text-gray-800">
          {toGigabytes(value)} / {toGigabytes(total)}
        </span>
      </div>
    </div>
  );
};

export default ModelDownloadingButton;
