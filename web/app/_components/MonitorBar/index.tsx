import ProgressBar from "../ProgressBar";
import SystemItem from "../SystemItem";
import { useAtomValue } from "jotai";
import { getSystemBarVisibilityAtom } from "@/_helpers/JotaiWrapper";

const MonitorBar: React.FC = () => {
  const show = useAtomValue(getSystemBarVisibilityAtom);
  const data = [
    {
      name: "CPU",
      total: 1400,
      used: 750,
    },
    {
      name: "Ram",
      total: 16000,
      used: 4500,
    },
    {
      name: "VRAM",
      total: 1400,
      used: 1300,
    },
    {
      name: "Active Models",
      total: 1400,
    },
  ];

  const version = "v1.2.2";
  if (!show) return null;

  return (
    <div className="flex items-center justify-between border-t border-gray-200">
      <ProgressBar total={1400} used={790} />
      <div className="flex items-center gap-8 px-2">
        {data.map((item, index) => (
          <SystemItem key={index} {...item} />
        ))}
        <span className="text-gray-900 text-sm">{version}</span>
      </div>
    </div>
  );
};

export default MonitorBar;
