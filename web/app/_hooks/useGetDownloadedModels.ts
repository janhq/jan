import { Product } from "@/_models/Product";
import { useEffect, useState } from "react";
import { executeSerial } from "../../../electron/core/plugin-manager/execution/extension-manager";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { getFinishedDownloadModels } from "../../middleware";

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useState<Product[]>([]);

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels);
    });
  }, []);

  return { downloadedModels };
}

export async function getDownloadedModels(): Promise<Product[]> {
  const downloadedModels: Product[] = await getFinishedDownloadModels();
  return downloadedModels ?? [];
}

export async function getModelFiles(): Promise<Product[]> {
  const downloadedModels: Product[] = await executeSerial(
    ModelManagementService.GET_DOWNLOADED_MODELS
  );
  return downloadedModels ?? [];
}

