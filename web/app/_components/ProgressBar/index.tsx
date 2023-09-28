import Image from "next/image";

type Props = {
  total: number;
  used: number;
};

const ProgressBar: React.FC<Props> = ({ used, total }) => {
  return (
    <div className="flex gap-[10px] items-center p-[10px]">
      <div className="text-xs leading-[18px] gap-0.5 flex items-center">
        <Image src={"/icons/app_icon.svg"} width={18} height={18} alt="" />
        Updating jan ...
      </div>
      <div className="w-[150px] relative bg-blue-200 h-1 rounded-md flex">
        <div
          className="absolute top-0 left-0 h-full rounded-md bg-blue-600"
          style={{ width: `${((used / total) * 100).toFixed(2)}%` }}
        ></div>
      </div>
      <div className="text-xs leading-[18px]">
        {((used / total) * 100).toFixed(0)}%
      </div>
    </div>
  );
};

export default ProgressBar;
