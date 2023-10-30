import Image from 'next/image'

type Props = {
  total: number
  used: number
}

const ProgressBar: React.FC<Props> = ({ used, total }) => (
  <div className="flex items-center gap-2.5">
    <div className="flex items-center gap-0.5 text-xs leading-[18px]">
      <Image src={'icons/app_icon.svg'} width={18} height={18} alt="" />
      Updating
    </div>
    <div className="relative flex h-1 w-[150px] rounded-md bg-blue-200">
      <div
        className="absolute left-0 top-0 h-full rounded-md bg-blue-600"
        style={{ width: `${((used / total) * 100).toFixed(2)}%` }}
      ></div>
    </div>
    <div className="text-xs leading-[18px]">
      {((used / total) * 100).toFixed(0)}%
    </div>
  </div>
)

export default ProgressBar
