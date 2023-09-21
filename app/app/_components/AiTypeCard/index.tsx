import Image from "next/image";
import Link from "next/link";

type Props = {
  name: string;
  imageUrl: string;
};

const AiTypeCard: React.FC<Props> = ({ imageUrl, name }) => {
  return (
    <Link href={`/ai/${name}`} className='flex-1'>
      <div className="flex-1 h-full bg-[#F3F4F6] flex items-center justify-center gap-[10px] py-[13px] rounded-[8px] px-4 active:opacity-50 hover:opacity-20">
        <Image src={imageUrl} width={82} height={82} alt="" />
        <span className="font-bold">{name}</span>
      </div>
    </Link>
  );
};

export default AiTypeCard;
