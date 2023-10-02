import React from "react";
import ModelVersionItem from "../ModelVersionItem";

const data = [
  {
    name: "Q4_K_M.gguf",
    total: 5600,
  },
  {
    name: "Q4_K_M.gguf",
    total: 5600,
  },
  {
    name: "Q4_K_M.gguf",
    total: 5600,
  },
];

const ModelVersionList: React.FC = () => {
  return (
    <div className="px-4 py-5 border-t border-gray-200">
      <div className="text-sm font-medium text-gray-500">
        Available Versions
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {data.map((item, index) => (
          <ModelVersionItem
            key={index}
            title={item.name}
            totalSizeInByte={item.total}
          />
        ))}
      </div>
    </div>
  );
};

export default ModelVersionList;
