import Image from "next/image";

type Props = {
  callback?: () => void;
  className?: string;
  icon: string;
  width: number;
  height: number;
  title: string;
};

export const SidebarButton: React.FC<Props> = ({
  callback,
  height,
  icon,
  className,
  width,
  title,
}) => (
  <button onClick={callback} className={className}>
    <Image src={icon} width={width} height={height} alt="" />
    <span>{title}</span>
  </button>
);
