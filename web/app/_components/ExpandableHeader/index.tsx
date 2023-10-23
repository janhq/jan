import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'

type Props = {
  title: string
}

const ExpandableHeader: React.FC<Props> = ({ title  }) => (
  <button className="flex items-center justify-between">
    <h2 className="pl-1 font-bold text-muted-foreground">
      {title}
    </h2>
  </button>
)

export default ExpandableHeader
