type Props = {
  onDeleteClick: () => void
}

const ModelActionMenu: React.FC<Props> = ({ onDeleteClick }) => (
  <button className="text-muted-foreground text-xs" onClick={onDeleteClick}>
    Delete
  </button>
)

export default ModelActionMenu
