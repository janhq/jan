import { ApiStep } from "../ApiStep";

const DescriptionPane: React.FC = () => {
  const data = [
    {
      title: "Install the Node.js client:",
      description: "npm install replicate",
    },
    {
      title:
        "Next, copy your API token and authenticate by setting it as an environment variable:",
      description:
        "export REPLICATE_API_TOKEN=r8_*************************************",
    },
    {
      title: "lorem ipsum dolor asimet",
      description: "come codes here",
    },
  ];

  return (
    <div className="flex flex-col gap-4 w-[full]">
      <h2 className="text-[20px] tracking-[-0.4px] leading-[25px]">
        Run the model
      </h2>
      {data.map((item, index) => (
        <ApiStep key={index} {...item} />
      ))}
    </div>
  );
};

export default DescriptionPane;
