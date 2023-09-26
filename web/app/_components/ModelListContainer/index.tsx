"use client";

import { useEffect, useState } from "react";
import DownloadModelCard from "../DownloadModelCard";
import { executeSerial } from "@/_services/pluginService";
import {
  InfereceService,
  ModelManagementService,
} from "../../../shared/coreService";
import { useAtomValue } from "jotai";
import { modelDownloadStateAtom } from "@/_helpers/JotaiWrapper";
import { Product } from "@/_models/Product";

const ModelListContainer: React.FC = () => {
  const [downloadedModels, setDownloadedModels] = useState<Product[]>([]);
  const [availableModels, setAvailableModels] = useState<Product[]>([]);
  const downloadState = useAtomValue(modelDownloadStateAtom);

  useEffect(() => {
    const getDownloadedModels = async () => {
      const avails = await executeSerial(
        ModelManagementService.GET_AVAILABLE_MODELS
      );

      const downloaded: Product[] = await executeSerial(
        ModelManagementService.GET_DOWNLOADED_MODELS
      );
      setAvailableModels(avails);
      setDownloadedModels(downloaded);
    };
    getDownloadedModels();
  }, []);

  const onDeleteClick = async (product: Product) => {
    await executeSerial(ModelManagementService.DELETE_MODEL, product.fileName);

    const avails = await executeSerial(
      ModelManagementService.GET_AVAILABLE_MODELS
    );

    const downloaded: Product[] = await executeSerial(
      ModelManagementService.GET_DOWNLOADED_MODELS
    );

    setAvailableModels(avails);
    setDownloadedModels(downloaded);
  };

  const initModel = async (product: Product) => {
    await executeSerial(InfereceService.INIT_MODEL, product);
  };

  const onDownloadClick = async (product: Product) => {
    console.log("onDownloadClick", product);
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, {
      downloadUrl: product.downloadUrl,
      fileName: product.fileName,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-5 flex flex-col gap-2">
        <Title title="Downloaded models" />
        {downloadedModels.map((item) => (
          <DownloadModelCard
            key={item.id}
            product={item}
            installed={true}
            onInitClick={initModel}
            onDeleteClick={onDeleteClick}
            isRecommend={false}
          />
        ))}
      </div>
      <div className="pb-5 flex flex-col gap-2">
        <Title title="Browse available models" />
        {availableModels.map((item) => (
          <DownloadModelCard
            key={item.id}
            product={item}
            downloading={downloadState == null}
            total={downloadState?.size.total ?? 0}
            transferred={downloadState?.size.transferred ?? 0}
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
