"use client";

import { useAtomValue } from "jotai";
import { searchingModelText } from "@/_helpers/JotaiWrapper";
import { Product } from "@/_models/Product";
import DownloadedModelCard from "../DownloadedModelCard";
import AvailableModelCard from "../AvailableModelCard";
import useDeleteModel from "@/_hooks/useDeleteModel";
import useGetAvailableModels from "@/_hooks/useGetAvailableModels";
import useDownloadModel from "@/_hooks/useDownloadModel";

const ModelListContainer: React.FC = () => {
  const searchText = useAtomValue(searchingModelText);
  const { deleteModel } = useDeleteModel();
  const { downloadModel } = useDownloadModel();

  const {
    availableModels,
    downloadedModels,
    getAvailableModelExceptDownloaded,
  } = useGetAvailableModels();

  const onDeleteClick = async (product: Product) => {
    await deleteModel(product);
    await getAvailableModelExceptDownloaded();
  };

  const onDownloadClick = async (model: Product) => {
    await downloadModel(model);
  };

  return (
    <div className="flex flex-col w-full h-full pl-[63px] pr-[89px] pt-[60px] overflow-y-auto">
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
