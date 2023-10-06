import ProgressBar from "../ProgressBar";
import SystemItem from "../SystemItem";
import { useAtomValue } from "jotai";
import { appDownloadProgress } from "@/_helpers/JotaiWrapper";
import { useEffect, useState } from "react";
import { getSystemBarVisibilityAtom } from "@/_helpers/atoms/SystemBar.atom";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";
import { appVersion, resourcesInfo, currentLoad } from "../../../middleware"

const MonitorBar: React.FC = () => {
  const show = useAtomValue(getSystemBarVisibilityAtom);
  const progress = useAtomValue(appDownloadProgress);
  const activeModel = useAtomValue(currentProductAtom);
  const [ram, setRam] = useState<number>(0);
  const [gpu, setGPU] = useState<number>(0);
  const [cpu, setCPU] = useState<number>(0);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    const getSystemResources = async () => {
      const resourceInfor = await resourcesInfo()
      console.log(resourceInfor)
      const currentLoadInfor = await currentLoad()
      console.log(currentLoadInfor)
      const ram =
        (resourceInfor?.mem?.used ?? 0) / (resourceInfor?.mem?.total ?? 1);
      setRam(Math.round(ram * 100));
      setCPU(Math.round(currentLoadInfor?.currentLoad ?? 0));
    };
    const getAppVersion = () => {
      appVersion().then((version: string | undefined) => {
        setVersion(version ?? "");
      });
    };
    getAppVersion();
    getSystemResources();
    // Fetch interval - every 3s
    const intervalId = setInterval(() => {
      getSystemResources();
    }, 3000);
    return () => clearInterval(intervalId);
  }, []);

  if (!show) return null;

  return (
    <div className="flex flex-row items-center justify-between border-t border-gray-200">
      {progress && progress >= 0 ? (
        <ProgressBar total={100} used={progress} />
      ) : (
        <div className="w-full" />
      )}
      <div className="flex-1 flex items-center gap-8 px-2">
        <SystemItem name="CPU" value={`${cpu}%`} />
        <SystemItem name="Mem" value={`${ram}%`} />

        {activeModel && (
          <SystemItem name={`Active model: ${activeModel.name}`} value={"1"} />
        )}
        <span className="text-gray-900 text-sm">v{version}</span>
      </div>
    </div>
  );
};

export default MonitorBar;
