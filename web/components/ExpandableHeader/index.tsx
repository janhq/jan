type Props = {
  title: string
}

const ExpandableHeader: React.FC<Props> = ({ title }) => (
  <button className="flex items-center justify-between">
    <h2 className="text-muted-foreground pl-1 font-bold">{title}</h2>
  </button>
)

export default ExpandableHeader
