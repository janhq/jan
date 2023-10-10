import React, { useEffect } from "react";
import ExploreModelItem from "../ExploreModelItem";
import { getConfiguredModels } from "@/_hooks/useGetDownloadedModels";
import useGetConfiguredModels from "@/_hooks/useGetConfiguredModels";

const ExploreModelList: React.FC = () => {
  const { models } = useGetConfiguredModels();

  useEffect(() => {
    getConfiguredModels();
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto scroll">
      {models.map((item) => (
        <ExploreModelItem key={item.id} model={item} />
      ))}
    </div>
  );
};

export default ExploreModelList;
