import React from "react";
import SearchBar from "../SearchBar";
import ModelTable from "../ModelTable";
import { useGetDownloadedModels } from "@/_hooks/useGetDownloadedModels";

const DownloadedModelTable: React.FC = () => {
  const { downloadedModels } = useGetDownloadedModels();

  if (!downloadedModels || downloadedModels.length === 0) return null;

  return (
    <div className="pl-[63px] pr-[89px]">
      <h3 className="text-xl leading-[25px] mt-[50px]">Downloaded Models</h3>
      <div className="py-5 w-[568px]">
        <SearchBar />
      </div>
      <ModelTable models={downloadedModels} />
    </div>
  );
};

export default DownloadedModelTable;
