import React from "react";
import { toGigabytes } from "@/_utils/converter";
import Image from "next/image";

type Props = {
  title: string;
  totalSizeInByte: number;
};

const ModelVersionItem: React.FC<Props> = ({ title, totalSizeInByte }) => (
  <div className="flex justify-between items-center gap-4 pl-[13px] pt-[13px] pr-[17px] pb-3 border-t border-gray-200 first:border-t-0">
    <div className="flex items-center gap-4">
      <Image src={"/icons/app_icon.svg"} width={14} height={20} alt="" />
      <span className="font-sm text-gray-900">{title}</span>
    </div>
    <div className="flex items-center gap-4">
      <div className="px-[10px] py-0.5 bg-gray-200 text-xs font-medium rounded">
        {toGigabytes(totalSizeInByte)}
      </div>
      <button className="text-indigo-600 text-sm font-medium">Download</button>
    </div>
  </div>
);

export default ModelVersionItem;
