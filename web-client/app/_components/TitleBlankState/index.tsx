type Props = {
  title: string;
};

export const TitleBlankState: React.FC<Props> = ({ title }) => {
  return (
    <h2 className="text-[#6B7280] text-[20px] leading-[25px] tracking-[-0.4px] font-semibold">
      {title}
    </h2>
  );
};
