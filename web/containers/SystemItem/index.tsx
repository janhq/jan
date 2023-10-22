type Props = {
  name: string
  value: string
}

const SystemItem: React.FC<Props> = ({ name, value }) => (
  <div className="flex items-center gap-x-1">
    <p className="font-semibold dark:text-gray-400">{name}</p>
    <p className="dark:text-gray-200">{value}</p>
  </div>
)

export default SystemItem
