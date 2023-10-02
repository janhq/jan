"use client";

import ExploreModelItemHeader from "../ExploreModelItemHeader";
import ModelVersionList from "../ModelVersionList";
import { useState } from "react";

type Props = {
  name: string;
  total: number;
  status: string;
  modelFormat: string;
  releaseDate: string;
  hardwareCompatibility: string[];
  expectedPerformance: string;
  description: string;
  tags: string[];
};

const ExploreModelItem: React.FC<Props> = ({
  name,
  total,
  status,
  description,
  expectedPerformance,
  hardwareCompatibility,
  modelFormat,
  releaseDate,
  tags,
}) => {
  const [show, setShow] = useState(false);

  return (
    <div className="flex flex-col border border-gray-200 rounded-[5px]">
      <ExploreModelItemHeader name={name} status={status} total={total} />
      <div className="flex flex-col px-[26px] py-[22px]">
        <div className="flex justify-between">
          <div className="flex-1 flex flex-col gap-8">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium text-gray-500">
                Model Format
              </div>
              <div className="px-[10px] py-0.5 bg-gray-100 text-xs text-gray-800 w-fit">
                {modelFormat}
              </div>
            </div>
            <div className="flex flex-col">
              <div className="text-sm font-medium text-gray-500">
                Hardware Compatibility
              </div>
              <div className="flex gap-2">
                {hardwareCompatibility.map((item) => (
                  <div
                    className="px-3 py-0.5 rounded bg-orange-100 text-yellow-800 w-fit text-xs font-medium"
                    key={item}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-8">
            <div>
              <div className="text-sm font-medium text-gray-500">
                Release Date
              </div>
              <div className="text-sm font-normal text-gray-900">
                {releaseDate}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-gray-500">
                Expected Performance
              </div>
              <div className="px-3 py-0.5 rounded bg-orange-100 text-yellow-800 w-fit text-xs font-medium">
                {expectedPerformance}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 mt-[26px]">
          <span className="text-sm font-medium text-gray-500">About</span>
          <span className="text-sm font-normal text-gray-500">
            {description}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-500">Tags</span>
        </div>
      </div>
      {show && <ModelVersionList />}
      <button
        onClick={() => setShow(!show)}
        className="bg-[#FBFBFB] text-gray-500 text-sm text-left py-2 px-4 border-t border-gray-200"
      >
        {!show ? "+ Show Available Versions" : "- Collapse"}
      </button>
    </div>
  );
};

export default ExploreModelItem;
