import Image from "next/image";
import ModelInfoItem from "../ModelInfoItem";
import React from "react";

type Props = {
  modelName: string;
  inferenceTime: string;
  hardware: string;
  pricing: string;
};

const ModelInfo: React.FC<Props> = ({
  modelName,
  inferenceTime,
  hardware,
  pricing,
}) => (
  <div className="flex flex-col rounded-lg border border-gray-200 p-3 gap-3">
    <h2 className="font-semibold text-sm text-gray-900 dark:text-white">
      {modelName} is available via Jan API
    </h2>
    <div className="flex items-start gap-4">
      <ModelInfoItem description={inferenceTime} name="Inference Time" />
      <ModelInfoItem description={hardware} name="Hardware" />
    </div>
    <hr />
    <div className="flex justify-between items-center ">
      <div className="flex flex-col">
        <h2 className="text-xl tracking-[-0.4px] font-semibold">{pricing}</h2>
        <span className="text-xs leading-[18px] text-[#6B7280]">
          Average Cost / Call
        </span>
      </div>
      <button className="px-3 py-2 bg-[#1F2A37] flex gap-2 items-center rounded-lg">
        <Image src={"/icons/code.svg"} width={16} height={17} alt="" />
        <span className="text-white text-sm font-medium">Get API Key</span>
      </button>
    </div>
  </div>
);

export default React.memo(ModelInfo);
