"use client";

import { useEffect, useState } from "react";
import { execute, executeSerial } from "@/_services/pluginService";
import {
  DataService,
  ModelManagementService,
} from "../../../shared/coreService";
import { useAtomValue } from "jotai";
import {
  modelDownloadStateAtom,
  searchingModelText,
} from "@/_helpers/JotaiWrapper";
import { Product } from "@/_models/Product";
import DownloadedModelCard from "../DownloadedModelCard";
import AvailableModelCard from "../AvailableModelCard";

const ModelListContainer: React.FC = () => {
  const [downloadedModels, setDownloadedModels] = useState<Product[]>([]);
  const [availableModels, setAvailableModels] = useState<Product[]>([]);
  const downloadState = useAtomValue(modelDownloadStateAtom);
  const searchText = useAtomValue(searchingModelText);

  useEffect(() => {
    const getDownloadedModels = async () => {
      const avails = await executeSerial(
        ModelManagementService.GET_AVAILABLE_MODELS
      );

      const downloaded: Product[] = await executeSerial(
        ModelManagementService.GET_DOWNLOADED_MODELS
      );

      const downloadedSucessfullyModels: Product[] = [];
      const availableOrDownloadingModels: Product[] = avails;

      downloaded.forEach((item) => {
        if (item.fileName && downloadState[item.fileName] == null) {
          downloadedSucessfullyModels.push(item);
        } else {
          availableOrDownloadingModels.push(item);
        }
      });

      setAvailableModels(availableOrDownloadingModels);
      setDownloadedModels(downloadedSucessfullyModels);
    };
    getDownloadedModels();
  }, [downloadState]);

  const onDeleteClick = async (product: Product) => {
    execute(DataService.DELETE_DOWNLOAD_MODEL, product.id);
    await executeSerial(ModelManagementService.DELETE_MODEL, product.fileName);
    const getDownloadedModels = async () => {
      const avails = await executeSerial(
        ModelManagementService.GET_AVAILABLE_MODELS
      );

      const downloaded: Product[] = await executeSerial(
        ModelManagementService.GET_DOWNLOADED_MODELS
      );

      const downloadedSucessfullyModels: Product[] = [];
      const availableOrDownloadingModels: Product[] = avails;

      downloaded.forEach((item) => {
        if (item.fileName && downloadState[item.fileName] == null) {
          downloadedSucessfullyModels.push(item);
        } else {
          availableOrDownloadingModels.push(item);
        }
      });

      setAvailableModels(availableOrDownloadingModels);
      setDownloadedModels(downloadedSucessfullyModels);
    };
    getDownloadedModels();
  };

  const onDownloadClick = async (product: Product) => {
    await executeSerial(DataService.STORE_MODEL, product);
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, {
      downloadUrl: product.downloadUrl,
      fileName: product.fileName,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-5 flex flex-col gap-2">
        <Title title="Downloaded models" />
        {downloadedModels
          ?.filter(
            (e) =>
              searchText.toLowerCase().trim() === "" ||
              e.name.toLowerCase().includes(searchText.toLowerCase())
          )
          .map((item) => (
            <DownloadedModelCard
              key={item.id}
              product={item}
              onDeleteClick={onDeleteClick}
              isRecommend={false}
            />
          ))}
      </div>
      <div className="pb-5 flex flex-col gap-2">
        <Title title="Browse available models" />
        {availableModels
          ?.filter(
            (e) =>
              searchText.toLowerCase().trim() === "" ||
              e.name.toLowerCase().includes(searchText.toLowerCase())
          )
          .map((item) => (
            <AvailableModelCard
              key={item.id}
              product={item}
              onDownloadClick={onDownloadClick}
              isRecommend={false}
            />
          ))}
      </div>
    </div>
  );
};

type Props = {
  title: string;
};

const Title: React.FC<Props> = ({ title }) => {
  return (
    <div className="flex gap-[10px]">
      <span className="font-semibold text-xl leading-[25px] tracking-[-0.4px]">
        {title}
      </span>
    </div>
  );
};

export default ModelListContainer;
