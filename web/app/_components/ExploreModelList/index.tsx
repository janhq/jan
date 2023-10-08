import React, { useEffect } from "react";
import ExploreModelItem from "../ExploreModelItem";
import { modelSearchAtom } from "@/_helpers/JotaiWrapper";
import useGetHuggingFaceModel from "@/_hooks/useGetHuggingFaceModel";
import { useAtom, useAtomValue } from "jotai";
import { useInView } from "react-intersection-observer";
import { modelLoadMoreAtom } from "@/_helpers/atoms/ExploreModelLoading.atom";
import { Waveform } from "@uiball/loaders";

const ExploreModelList: React.FC = () => {
  const [loadMoreInProgress, setLoadMoreInProress] = useAtom(modelLoadMoreAtom);
  const modelSearch = useAtomValue(modelSearchAtom);
  const { modelList, getHuggingFaceModel } = useGetHuggingFaceModel();
  const { ref, inView } = useInView({
    threshold: 0,
    triggerOnce: true,
  });

  useEffect(() => {
    if (modelList.length === 0 && modelSearch.length > 0) {
      setLoadMoreInProress(true);
    }
    getHuggingFaceModel(modelSearch);
  }, [modelSearch]);

  useEffect(() => {
    if (inView) {
      console.debug("Load more models..");
      setLoadMoreInProress(true);
      getHuggingFaceModel(modelSearch);
    }
  }, [inView]);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto scroll">
      {modelList.map((item, index) => (
        <ExploreModelItem
          ref={index === modelList.length - 1 ? ref : null}
          key={item.id}
          model={item}
        />
      ))}
      {loadMoreInProgress && (
        <div className="mx-auto mt-2 mb-4">
          <Waveform size={24} color="#9CA3AF" />
        </div>
      )}
    </div>
  );
};

export default ExploreModelList;
