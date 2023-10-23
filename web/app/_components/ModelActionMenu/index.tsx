import { Menu, Transition } from '@headlessui/react'
import { EllipsisVerticalIcon } from '@heroicons/react/20/solid'
import { Fragment } from 'react'

type Props = {
  onDeleteClick: () => void
}

const ModelActionMenu: React.FC<Props> = ({ onDeleteClick }) => (
  <button className="text-muted-foreground text-xs" onClick={onDeleteClick}>
    Delete
  </button>
)

export default ModelActionMenu
