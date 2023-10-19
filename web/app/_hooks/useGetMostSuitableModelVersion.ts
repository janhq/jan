import { ModelVersion } from "@/_models/ModelVersion";
import { useState } from "react";
import { useAtomValue } from "jotai";
import { totalRamAtom } from "@/_helpers/atoms/SystemBar.atom";

export default function useGetMostSuitableModelVersion() {
  const [suitableModel, setSuitableModel] = useState<ModelVersion | undefined>();
  const totalRam = useAtomValue(totalRamAtom);

  const getMostSuitableModelVersion = async (modelVersions: ModelVersion[]) => {
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
