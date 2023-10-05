import { useState } from "react";
import { searchHfModels } from "./useGetDownloadedModels";
import { SearchModelParamHf } from "@/_models/hf/SearchModelParam.hf";
import { Product } from "@/_models/Product";

export default function useGetHuggingFaceModel() {
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
    const result = await searchHfModels(searchParams);
    console.debug("result", JSON.stringify(result));
    if (owner !== currentOwner) {
      setModelList(result.data);
      setCurrentOwner(owner);
    } else {
      setModelList([...modelList, ...result.data]);
    }
  };

  return { modelList, getHuggingFaceModel };
}
