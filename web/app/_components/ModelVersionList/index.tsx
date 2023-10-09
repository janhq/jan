import React from "react";
import ModelVersionItem from "../ModelVersionItem";
import { ModelVersion, Product } from "@/_models/Product";

type Props = {
  model: Product;
  versions: ModelVersion[];
};

const ModelVersionList: React.FC<Props> = ({ model, versions }) => (
  <div className="px-4 py-5 border-t border-gray-200">
    <div className="text-sm font-medium text-gray-500">Available Versions</div>
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {versions.map((item) => (
        <ModelVersionItem key={item.path} model={model} modelVersion={item} />
      ))}
    </div>
  </div>
);

export default ModelVersionList;
