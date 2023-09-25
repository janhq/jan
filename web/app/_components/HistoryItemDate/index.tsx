import { displayDate } from "@/_utils/datetime";
import React from "react";

type Props = {
  timestamp: number;
};

const HistoryItemDate: React.FC<Props> = ({ timestamp }) => {
  return <p className="text-gray-400 text-xs">{displayDate(timestamp)}</p>;
};

export default React.memo(HistoryItemDate);
