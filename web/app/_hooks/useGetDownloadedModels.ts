import { ModelVersion, Product, ProductType } from "@/_models/Product";
import { useEffect } from "react";
import { executeSerial } from "../../../electron/core/plugin-manager/execution/extension-manager";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { SearchModelParamHf } from "@/_models/hf/SearchModelParam.hf";
import { useAtom } from "jotai";
import { downloadedModelAtom } from "@/_helpers/atoms/DownloadedModel.atom";

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelAtom);

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels);
    });
  }, []);

  return { downloadedModels };
}

export async function getDownloadedModels(): Promise<Product[]> {
  const downloadedModels: Product[] = await executeSerial(
    DataService.GET_FINISHED_DOWNLOAD_MODELS
  );
  return downloadedModels ?? [];
}

export async function getModelFiles(): Promise<Product[]> {
  const downloadedModels: Product[] = await executeSerial(
    ModelManagementService.GET_DOWNLOADED_MODELS
  );
  return downloadedModels ?? [];
}

export async function searchHfModels(
  params: SearchModelParamHf
): Promise<QueryProductResult> {
  const result = await executeSerial(
    ModelManagementService.SEARCH_HF_MODELS,
    params
  );

  const products: Product[] = result.data.map((model: any) => {
    const modelVersions: ModelVersion[] = [];

    for (const [, file] of Object.entries(model.files)) {
      const fileData: any = file as any;
      const modelVersion: ModelVersion = {
        path: fileData.path,
        type: fileData.type,
        downloadUrl: fileData.downloadLink,
        size: fileData.size,
      };
      modelVersions.push(modelVersion);
    }

    const p = {
      id: model.id,
      slug: model.name,
      name: model.name,
      description: model.name,
      avatarUrl: "",
      longDescription: model.name,
      technicalDescription: model.name,
      author: model.name.split("/")[0],
      version: "1.0.0",
      modelUrl: "https://google.com",
      nsfw: false,
      greeting: "Hello there",
      type: ProductType.LLM,
      createdAt: -1,
      accelerated: true,
      totalSize: -1,
      format: "",
      status: "Not downloaded",
      releaseDate: -1,
      availableVersions: modelVersions,
    };

    return p;
  });

  return {
    data: products,
    hasMore: result.hasMore,
  };
}

// TODO define somewhere else
export type QueryProductResult = {
  data: Product[];
  hasMore: boolean;
};
