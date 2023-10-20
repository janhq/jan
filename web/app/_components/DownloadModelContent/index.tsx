import DownloadModelTitle from '../DownloadModelTitle'

type Props = {
  author: string
  description: string
  isRecommend: boolean
  name: string
  type: string
  required?: string
}

const DownloadModelContent: React.FC<Props> = ({
  author,
  description,
  isRecommend,
  name,
  required,
  type,
}) => {
  return (
    <div className="flex w-4/5 flex-col gap-2.5">
      <div className="flex items-center gap-1">
        <h2 className="text-xl font-medium leading-[25px] tracking-[-0.4px] text-gray-900">
          {name}
        </h2>
        <DownloadModelTitle title={type} />
        <div className="rounded-md bg-purple-100 px-2.5 py-0.5 text-center">
          <span className="text-xs font-semibold leading-[18px] text-purple-800">
            {author}
          </span>
        </div>
        {required && (
          <div className="rounded-md bg-purple-100 px-2.5 py-0.5 text-center">
            <span className="text-xs leading-[18px] text-[#11192899]">
              Required{' '}
            </span>
            <span className="text-xs font-semibold leading-[18px] text-gray-900">
              {required}
            </span>
          </div>
        )}
      </div>
      <p className="text-xs leading-[18px] text-gray-500">{description}</p>
      <div
        className={`${
          isRecommend ? 'flex' : 'hidden'
        } w-fit items-center justify-center gap-2 rounded-full bg-green-50 px-2.5 py-0.5`}
      >
        <div className="h-3 w-3 rounded-full bg-green-400"></div>
        <span className="leading-18px text-xs font-medium text-green-600">
          Recommend
        </span>
      </div>
    </div>
  )
}

export default DownloadModelContent
