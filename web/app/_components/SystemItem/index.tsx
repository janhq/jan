type Props = {
  name: string
  value: string
}

const SystemItem: React.FC<Props> = ({ name, value }) => (
  <div className="my-1 flex gap-2 pl-4">
    <div className="flex w-max gap-2.5 text-sm font-bold text-gray-900">
      {name}
    </div>
    <span className="text-sm text-gray-900">{value}</span>
  </div>
)

export default SystemItem
