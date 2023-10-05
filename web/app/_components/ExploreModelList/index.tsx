import React, { useEffect } from "react";
import ExploreModelItem from "../ExploreModelItem";
import { modelSearchAtom } from "@/_helpers/JotaiWrapper";
import useGetHuggingFaceModel from "@/_hooks/useGetHuggingFaceModel";
import { useAtomValue } from "jotai";

const ExploreModelList: React.FC = () => {
  const modelSearch = useAtomValue(modelSearchAtom);
  const { modelList, getHuggingFaceModel } = useGetHuggingFaceModel();

  useEffect(() => {
    getHuggingFaceModel(modelSearch);
  }, [modelSearch]);

  return (
    <div className="flex-1 overflow-y-auto scroll">
      {modelList.map((item) => (
        <ExploreModelItem key={item.id} model={item} />
      ))}
    </div>
  );
};

export default ExploreModelList;
