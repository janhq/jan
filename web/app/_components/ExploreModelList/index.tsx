import React, { useEffect } from "react";
import ExploreModelItem from "../ExploreModelItem";
import { getConfiguredModels } from "@/_hooks/useGetDownloadedModels";
import useGetConfiguredModels from "@/_hooks/useGetConfiguredModels";
import { Waveform } from "@uiball/loaders";

const ExploreModelList: React.FC = () => {
  const { loading, models } = useGetConfiguredModels();

  useEffect(() => {
    getConfiguredModels();
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto scroll">
      {loading && (
        <div className="mx-auto">
          <Waveform size={24} color="#CBD5E0" />
        </div>
      )}
      {models.map((item) => (
        <ExploreModelItem key={item._id} model={item} />
      ))}
    </div>
  );
};

export default ExploreModelList;
