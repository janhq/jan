import React, { Fragment } from "react";
import { modelDownloadStateAtom } from "@/_helpers/atoms/DownloadState.atom";
import { useAtomValue } from "jotai";
import ModelDownloadingTable from "../ModelDownloadingTable";
import { DownloadState } from "@/_models/DownloadState";

const DownloadingModelTable: React.FC = () => {
  const modelDownloadState = useAtomValue(modelDownloadStateAtom);

  const isAnyModelDownloading = Object.values(modelDownloadState).length > 0;

  if (!isAnyModelDownloading) return null;

  const downloadStates: DownloadState[] = [];
  for (const [, value] of Object.entries(modelDownloadState)) {
    downloadStates.push(value);
  }

  return (
    <div className="pl-[63px] pr-[89px]">
      <h3 className="text-xl leading-[25px] mt-[50px] mb-4">
        Downloading Models
      </h3>
      <ModelDownloadingTable downloadStates={downloadStates} />
    </div>
  );
};

export default DownloadingModelTable;
