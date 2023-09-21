import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";

type Props = {
  callback: () => void;
};

const ModelDownloadButton: React.FC<Props> = ({ callback }) => {
  return (
    <button
      className="bg-[#1A56DB] rounded-lg py-2 px-3 flex items-center gap-2"
      onClick={callback}
    >
      <ArrowDownTrayIcon width={16} height={16} color="#FFFFFF" />
      <span className="text-xs leading-[18px] text-[#fff] font-medium">
        Download
      </span>
    </button>
  );
};

export default ModelDownloadButton;
