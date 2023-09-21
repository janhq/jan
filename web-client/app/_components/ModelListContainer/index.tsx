"use client";

import { useEffect, useState } from "react";
import DownloadModelCard from "../DownloadModelCard";
import { invokeModelManagementService } from "@/_services/pluginService";
import { ModelManagementService } from "../../../shared/coreService";

const ModelListContainer: React.FC = () => {
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
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
        name: "LlaMa 2 - Hermes 7B (Q4_K_M)",
        type: "7B",
        author: "Architecture Llama",
        description:
          "Primary intended uses The primary use of LLaMA is research on large language models, including: exploring potential applications such as question answering, natural language understanding or reading comprehension, understanding capabilities and limitations of current language models, and developing techniques to improve those, evaluating and mitigating biases, risks, toxic and harmful content generations, hallucinations.",
        isRecommend: true,
        storage: 3780,
        required: "8GB+ RAM",
      },
      {
        name: "LlaMa 2 - Hermes 7B (Q4_K_M)",
        type: "7B",
        author: "Architecture Llama",
        description:
          "Primary intended uses The primary use of LLaMA is research on large language models, including: exploring potential applications such as question answering, natural language understanding or reading comprehension, understanding capabilities and limitations of current language models, and developing techniques to improve those, evaluating and mitigating biases, risks, toxic and harmful content generations, hallucinations.",
        isRecommend: true,
        storage: 3780,
        required: "8GB+ RAM",
      },
    ],
  };

  useEffect(() => {
    const getDownloadedModels = async () => {
      const modelNames = await invokeModelManagementService(
        ModelManagementService.GET_DOWNLOADED_MODELS
      );
      setDownloadedModels(modelNames);
    };
    getDownloadedModels();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-5 flex flex-col gap-2">
        <Title title={DownloadedModel.title} />
        {downloadedModels.length > 0
          ? DownloadedModel.data.map((item, index) => (
              <DownloadModelCard key={index} {...item} installed={true} />
            ))
          : null}
      </div>
      <div className="pb-5 flex flex-col gap-2">
        <Title title={BrowseAvailableModels.title} />
        {BrowseAvailableModels.data.map((item, index) => (
          <DownloadModelCard key={index} {...item} />
        ))}
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
