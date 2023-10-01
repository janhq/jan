import ProgressBar from "../ProgressBar";
import SystemItem from "../SystemItem";
import { useAtomValue } from "jotai";
import {
  activeModel,
  appDownloadProgress,
  getSystemBarVisibilityAtom,
} from "@/_helpers/JotaiWrapper";
import { useEffect, useState } from "react";
import { executeSerial } from "../../../../electron/core/plugin-manager/execution/extension-manager";
import { SystemMonitoringService } from "../../../shared/coreService";

const MonitorBar: React.FC = () => {
  const show = useAtomValue(getSystemBarVisibilityAtom);
  const progress = useAtomValue(appDownloadProgress);
  const modelName = useAtomValue(activeModel);
  const [ram, setRam] = useState<number>(0);
  const [gpu, setGPU] = useState<number>(0);
  const [cpu, setCPU] = useState<number>(0);
  const [version, setVersion] = useState<string>("");

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

  useEffect(() => {
    const getSystemResources = async () => {
      const resourceInfor = await executeSerial(
        SystemMonitoringService.GET_RESOURCES_INFORMATION
      );
      const currentLoadInfor = await executeSerial(
        SystemMonitoringService.GET_CURRENT_LOAD_INFORMATION
      );
      const ram =
        (resourceInfor?.mem?.used ?? 0) / (resourceInfor?.mem?.total ?? 1);
      setRam(Math.round(ram * 100));
      setCPU(Math.round(currentLoadInfor?.currentLoad ?? 0));
    };
    const getAppVersion = () => {
      window.electronAPI.appVersion().then((version: string | undefined) => {
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

        {modelName && modelName.length > 0 && (
          <SystemItem name="Active Models" value={"1"} />
        )}
        <span className="text-gray-900 text-sm">v{version}</span>
      </div>
    </div>
  );
};

export default MonitorBar;
