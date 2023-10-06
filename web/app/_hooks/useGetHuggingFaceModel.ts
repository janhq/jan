import { useState } from "react";
import { searchModels } from "./useGetDownloadedModels";
import { SearchModelParamHf } from "@/_models/hf/SearchModelParam.hf";
import { Product } from "@/_models/Product";
import { useSetAtom } from "jotai";
import { modelLoadMoreAtom } from "@/_helpers/atoms/ExploreModelLoading.atom";

export default function useGetHuggingFaceModel() {
  const setLoadMoreInProgress = useSetAtom(modelLoadMoreAtom);
  const [modelList, setModelList] = useState<Product[]>([]);
  const [currentOwner, setCurrentOwner] = useState<string | undefined>(
    undefined
  );

  const getHuggingFaceModel = async (owner?: string) => {
    if (!owner) {
      setModelList([]);
      return;
    }

    const searchParams: SearchModelParamHf = {
      search: { owner },
      limit: 5,
    };
    const result = await searchModels(searchParams);
    console.debug("result", JSON.stringify(result));
    if (owner !== currentOwner) {
      setModelList(result.data);
      setCurrentOwner(owner);
    } else {
      setModelList([...modelList, ...result.data]);
    }
    setLoadMoreInProgress(false);
  };

  return { modelList, getHuggingFaceModel };
}
