"use client";

import ExploreModelItemHeader from "../ExploreModelItemHeader";
import ModelVersionList from "../ModelVersionList";
import { useState } from "react";
import { Product } from "@/_models/Product";
import SimpleTag, { TagType } from "../SimpleTag";
import { displayDate } from "@/_utils/datetime";

type Props = {
  model: Product;
};

const ExploreModelItem: React.FC<Props> = ({ model }) => {
  const [show, setShow] = useState(false);

  return (
    <div className="flex flex-col border border-gray-200 rounded-[5px]">
      <ExploreModelItemHeader
        name={model.name}
        status={TagType.Recommended}
        total={model.totalSize}
      />
      <div className="flex flex-col px-[26px] py-[22px]">
        <div className="flex justify-between">
          <div className="flex-1 flex flex-col gap-8">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium text-gray-500">
                Model Format
              </div>
              <div className="px-[10px] py-0.5 bg-gray-100 text-xs text-gray-800 w-fit">
                GGUF
              </div>
            </div>
            <div className="flex flex-col">
              <div className="text-sm font-medium text-gray-500">
                Hardware Compatibility
              </div>
              <div className="flex gap-2">
                <SimpleTag
                  clickable={false}
                  title={TagType.Compatible}
                  type={TagType.Compatible}
                />
              </div>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-8">
            <div>
              <div className="text-sm font-medium text-gray-500">
                Release Date
              </div>
              <div className="text-sm font-normal text-gray-900">
                {displayDate(model.releaseDate)}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-gray-500">
                Expected Performance
              </div>
              <SimpleTag
                title={TagType.Medium}
                type={TagType.Medium}
                clickable={false}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 mt-[26px]">
          <span className="text-sm font-medium text-gray-500">About</span>
          <span className="text-sm font-normal text-gray-500">
            {model.longDescription}
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
