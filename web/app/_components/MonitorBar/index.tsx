import ProgressBar from "../ProgressBar";
import SystemItem from "../SystemItem";
import { useAtomValue } from "jotai";
import {
  activeModel,
  appDownloadProgress,
  getSystemBarVisibilityAtom,
} from "@/_helpers/JotaiWrapper";

const MonitorBar: React.FC = () => {
  const show = useAtomValue(getSystemBarVisibilityAtom);
  const progress = useAtomValue(appDownloadProgress);
  const modelName = useAtomValue(activeModel);

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
  ];

  const version = "v1.2.2";
  if (!show) return null;

  return (
    <div className="flex items-center justify-between border-t border-gray-200">
      {progress && progress >= 0 && <ProgressBar total={100} used={progress} />}
      <div className="flex items-center gap-8 px-2">
        {data.map((item, index) => (
          <SystemItem key={index} {...item} />
        ))}
        {modelName && modelName.length > 0 && (
          <SystemItem name="Active Models" total={1} used={1} />
        )}
        <span className="text-gray-900 text-sm">{version}</span>
      </div>
    </div>
  );
};

export default MonitorBar;
