import { Product } from "@/_models/Product";
import { useEffect, useState } from "react";
import { getConfiguredModels } from "./useGetDownloadedModels";

export default function useGetConfiguredModels() {
  const [loading, setLoading] = useState<boolean>(false);
  const [models, setModels] = useState<Product[]>([]);

  const fetchModels = async () => {
    setLoading(true);
    const models = await getConfiguredModels();
    setLoading(false);
    setModels(models);
  };

  // TODO allow user for filter
  useEffect(() => {
    fetchModels();
  }, []);

  return { loading, models };
}
