type Props = {
  name?: string
  value: string
}

export default function SystemItem({ name, value }: Props) {
  return (
    <div className="flex items-center gap-x-1">
      <p className="text-xs">{name}</p>
      <span className="text-xs">{value}</span>
    </div>
  )
}
