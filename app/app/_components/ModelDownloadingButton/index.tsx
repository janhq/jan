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
      <div className="py-[2px] px-[10px] bg-gray-200 rounded">
        <span className="text-xs font-medium text-gray-800">
          {toGigabytes(value)} / {toGigabytes(total)}
        </span>
      </div>
    </div>
  );
};

const toGigabytes = (input: number) => {
  if (input > 1024 ** 3) {
    return (input / 1000 ** 3).toFixed(2) + "GB";
  } else if (input > 1024 ** 2) {
    return (input / 1000 ** 2).toFixed(2) + "MB";
  } else if (input > 1024) {
    return (input / 1000).toFixed(2) + "KB";
  } else {
    return input + "B";
  }
};

export default ModelDownloadingButton;
