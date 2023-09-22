type Props = {
  name: string;
  total: number;
  value: number;
};

const SystemItem: React.FC<Props> = ({ name, total, value }) => {
  return (
    <div className="border-l border-gray-200 flex gap-2 pl-4">
      <div className="flex gap-[10px] p-1 bg-gray-100 text-gray-600 text-[11px] leading-[13px]">
        {name}
      </div>
      <span className="text-gray-500 text-sm">
        {toGigabytes(value)} / {toGigabytes(total)}{" "}
        {((value / total) * 100).toFixed(2)} %
      </span>
    </div>
  );
};

const toGigabytes = (input: number) => {
  return input > 1000 ? input / 1000 + "GB" : input + "MB";
};

export default SystemItem;
