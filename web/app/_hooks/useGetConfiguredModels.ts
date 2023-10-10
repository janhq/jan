import { Product } from "@/_models/Product";
import { useEffect, useState } from "react";
import { getConfiguredModels } from "./useGetDownloadedModels";

export default function useGetConfiguredModels() {
  const [models, setModels] = useState<Product[]>([]);

  const fetchModels = async () => {
    const models = await getConfiguredModels();

    setModels(models);
  };

  // TODO allow user for filter
  useEffect(() => {
    fetchModels();
  }, []);

  return { models };
}
