import Image from "next/image";
import SystemStatus from "../SystemStatus";
import { SidebarButton } from "../SidebarButton";

const Welcome: React.FC = () => {
  const data = {
    name: "LlaMa 2 - Hermes 7B (Q4_K_M)",
    type: "7B",
    author: "Architecture Llama",
    description:
      "Primary intended uses The primary use of LLaMA is research on large language models, including: exploring potential applications such as question answering, natural language understanding or reading comprehension, understanding capabilities and limitations of current language models, and developing techniques to improve those, evaluating and mitigating biases, risks, toxic and harmful content generations, hallucinations.",
    isRecommend: true,
    storage: 3780,
    required: "8GB+ RAM",
  };
  const system = [
    {
      name: "GPU",
      value: 782.2,
      total: 14000,
    },
    {
      name: "RAM",
      value: 5100,
      total: 14000,
    },
    {
      name: "STORAGE",
      value: 500000,
      total: 1000000,
    },
  ];
  return (
    <div className="flex flex-col h-full">
      <div className="px-[200px] flex-1 flex flex-col gap-5 justify-center items-start">
        <Image src={"/icons/App_ico.svg"} width={44} height={45} alt="" />
        <span className="font-semibold text-gray-500 text-5xl">
          Welcome,
          <br />
          let’s download your first model
        </span>
        <SidebarButton
          className="flex flex-row-reverse items-center rounded-lg gap-2 px-3 py-2 text-xs font-medium border border-gray-200"
          icon="/icons/arrow-right.svg"
          title="Explore models"
          height={16}
          width={16}
        />
      </div>
      <div className="px-3 py-2 gap-4 flex items-center justify-center">
        <span className="text-gray-500 text-sm">System status</span>
        {system.map((item, index) => (
          <SystemStatus key={index} {...item} />
        ))}
      </div>
    </div>
  );
};

export default Welcome;
