import { executeSerial } from "@/_services/pluginService";
import { SystemMonitoringService } from "../../shared/coreService";
import { ModelVersion } from "@/_models/ModelVersion";
import { useState } from "react";

export default function useGetMostSuitableModelVersion() {
  const [suitableModel, setSuitableModel] = useState<ModelVersion | undefined>();

  const getMostSuitableModelVersion = async (modelVersions: ModelVersion[]) => {
    const resourceInfo = await executeSerial(
      SystemMonitoringService.GET_RESOURCES_INFORMATION
    );
    const totalRam = resourceInfo.mem.total;

    // find the model version with the highest required RAM that is still below the user's RAM by 80%
    const modelVersion = modelVersions.reduce((prev, current) => {
      if (current.maxRamRequired > prev.maxRamRequired) {
        if (current.maxRamRequired < totalRam * 0.8) {
          return current;
        }
      }
      return prev;
    });

    setSuitableModel(modelVersion);
  };

  return { suitableModel, getMostSuitableModelVersion };
}
