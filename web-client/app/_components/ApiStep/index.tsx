type Props = {
  title: string;
  description: string;
};

export const ApiStep: React.FC<Props> = ({ description, title }) => {
  return (
    <div className="gap-2 flex flex-col">
      <span className="text-[#8A8A8A]">{title}</span>
      <div className="flex flex-col gap-[10px] p-[18px] bg-[#F9F9F9] overflow-y-hidden">
        <pre className="text-sm leading-5 text-black">{description}</pre>
      </div>
    </div>
  );
};
