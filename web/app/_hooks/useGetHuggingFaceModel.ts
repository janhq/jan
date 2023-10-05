import { useState } from "react";
import { searchHfModels } from "./useGetDownloadedModels";
import { SearchModelParamHf } from "@/_models/hf/SearchModelParam.hf";
import { Product } from "@/_models/Product";

export default function useGetHuggingFaceModel() {
  const [modelList, setModelList] = useState<Product[]>([]);

  const getHuggingFaceModel = async (owner?: string) => {
    if (!owner) {
      setModelList([]);
      return;
    }

    const searchParams: SearchModelParamHf = {
      search: { owner },
      limit: 10,
    };
    const result = await searchHfModels(searchParams);
    console.debug("result", JSON.stringify(result));
    setModelList(result);
  };

  return { modelList, getHuggingFaceModel };
}
