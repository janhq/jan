type Props = {
  title: string
}

export const DownloadModelTitle: React.FC<Props> = ({ title }) => (
  <div className="rounded-md bg-purple-100 px-2.5 py-0.5 text-center">
    <span className="text-xs font-medium leading-[18px] text-purple-800">
      {title}
    </span>
  </div>
)

export default DownloadModelTitle
