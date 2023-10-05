import React, { useEffect } from "react";
import ExploreModelItem from "../ExploreModelItem";
import { modelSearchAtom } from "@/_helpers/JotaiWrapper";
import useGetHuggingFaceModel from "@/_hooks/useGetHuggingFaceModel";
import { useAtomValue } from "jotai";
import { useInView } from "react-intersection-observer";

const ExploreModelList: React.FC = () => {
  const modelSearch = useAtomValue(modelSearchAtom);
  const { modelList, getHuggingFaceModel } = useGetHuggingFaceModel();
  const { ref, inView } = useInView({
    threshold: 0,
    triggerOnce: true,
  });

  useEffect(() => {
    getHuggingFaceModel(modelSearch);
  }, [modelSearch]);

  useEffect(() => {
    if (inView) {
      console.debug("Load more models..");
      getHuggingFaceModel(modelSearch);
    }
  }, [inView]);

  return (
    <div className="flex-1 overflow-y-auto scroll">
      {modelList.map((item, index) => (
        <ExploreModelItem
          ref={index === modelList.length - 1 ? ref : null}
          key={item.id}
          model={item}
        />
      ))}
    </div>
  );
};

export default ExploreModelList;
