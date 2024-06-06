import Image from 'next/image'

type Props = {
  title: string
  imageUrl?: string
  subTitle: string
}

const GroupInfo: React.FC<Props> = ({ title, imageUrl, subTitle }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center gap-1 text-lg font-semibold">
      {imageUrl && (
        <Image width={24} height={24} src={imageUrl} alt="Group Logo" />
      )}
      {title}
    </div>
    <span className="text-sm text-[var(--text-secondary)]">{subTitle}</span>
  </div>
)

export default GroupInfo
