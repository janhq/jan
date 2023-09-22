"use client";

import { useEffect, useState } from "react";
import DownloadModelCard from "../DownloadModelCard";
import { executeSerial } from "@/_services/pluginService";
import { ModelManagementService } from "../../../shared/coreService";
import { useAtomValue } from "jotai";
import { modelDownloadStateAtom } from "@/_helpers/JotaiWrapper";

const ModelListContainer: React.FC = () => {
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const downloadState = useAtomValue(modelDownloadStateAtom);
  const DownloadedModel = {
    title: "Downloaded Model",
    data: [
      {
        name: "Llama 2 7B Chat - GGML",
        type: "7B",
        author: "The Bloke",
        description:
          "Primary intended uses The primary use of LLaMA is research on large language models, including: exploring potential applications such as question answering, natural language understanding or reading comprehension, understanding capabilities and limitations of current language models, and developing techniques to improve those, evaluating and mitigating biases, risks, toxic and harmful content generations, hallucinations.",
        isRecommend: true,
        storage: 3780,
        default: true,
      },
    ],
  };

  const BrowseAvailableModels = {
    title: "Browse Available Models",
    data: [
      {
        name: "Llama 2 7B Chat - GGML",
        type: "7B",
        author: "The Bloke",
        description:
          "Primary intended uses The primary use of LLaMA is research on large language models, including: exploring potential applications such as question answering, natural language understanding or reading comprehension, understanding capabilities and limitations of current language models, and developing techniques to improve those, evaluating and mitigating biases, risks, toxic and harmful content generations, hallucinations.",
        isRecommend: true,
        storage: 3780,
        default: true,
      },
    ],
  };

  useEffect(() => {
    const getDownloadedModels = async () => {
      const modelNames = await executeSerial(
        ModelManagementService.GET_DOWNLOADED_MODELS
      );
      setDownloadedModels(modelNames);
    };
    getDownloadedModels();
  }, []);

  const onDeleteClick = async () => {
    // TODO: for now we only support 1 model
    if (downloadedModels?.length < 1) {
      return;
    }
    console.log(downloadedModels[0]);
    const pathArray = downloadedModels[0].split("/");
    const modelName = pathArray[pathArray.length - 1];
    console.log(`Prepare to delete ${modelName}`);
    // setShow(true); // TODO: later
    await executeSerial(ModelManagementService.DELETE_MODEL, modelName);

    setDownloadedModels([]);
  };

  const onDownloadClick = async () => {
    const url =
      "https://huggingface.co/TheBloke/Llama-2-7b-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_0.gguf";
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, url);
  };

  console.log(downloadState);

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-5 flex flex-col gap-2">
        <Title title={DownloadedModel.title} />
        {downloadedModels?.length > 0 &&
          DownloadedModel.data.map((item, index) => (
            <DownloadModelCard
              key={index}
              {...item}
              installed={true}
              onDeleteClick={onDeleteClick}
            />
          ))}
      </div>
      <div className="pb-5 flex flex-col gap-2">
        {downloadedModels.length === 0 && (
          <>
            <Title title={BrowseAvailableModels.title} />
            {BrowseAvailableModels.data.map((item, index) => (
              <DownloadModelCard
                key={index}
                {...item}
                downloading={downloadState == null}
                total={downloadState?.size.total ?? 0}
                transferred={downloadState?.size.transferred ?? 0}
                onDownloadClick={onDownloadClick}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

type Props = {
  title: string;
};

const Title: React.FC<Props> = ({ title }) => {
  return (
    <div className="flex gap-[10px]">
      <span className="font-semibold text-xl leading-[25px] tracking-[-0.4px]">
        {title}
      </span>
    </div>
  );
};

export default ModelListContainer;
