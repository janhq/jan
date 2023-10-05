import React from "react";
import ModelTableHeader from "../ModelTableHeader";
import { DownloadState } from "@/_models/DownloadState";
import ModelDownloadingRow from "../ModelDownloadingRow";

type Props = {
  downloadStates: DownloadState[];
};

const tableHeaders = ["MODEL", "TRANSFERRED", "SIZE", "PERCENTAGE", "SPEED"];

const ModelDownloadingTable: React.FC<Props> = ({ downloadStates }) => (
  <div className="flow-root border rounded-lg border-gray-200 min-w-full align-middle shadow-lg">
    <table className="min-w-full">
      <thead className="bg-gray-50 border-b border-gray-200">
        <tr className="rounded-t-lg">
          {tableHeaders.map((item) => (
            <ModelTableHeader key={item} title={item} />
          ))}
          <th scope="col" className="relative px-6 py-3 w-fit">
            <span className="sr-only">Edit</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {downloadStates.map((state) => (
          <ModelDownloadingRow key={state.fileName} downloadState={state} />
        ))}
      </tbody>
    </table>
  </div>
);

export default React.memo(ModelDownloadingTable);
