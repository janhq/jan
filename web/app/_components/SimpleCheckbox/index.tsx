type Props = {
  name: string
}

const SimpleCheckbox: React.FC<Props> = ({ name }) => (
  <div className="relative flex items-center gap-[11px]">
    <div className="flex h-6 items-center">
      <input
        id="offers"
        aria-describedby="offers-description"
        name="offers"
        type="checkbox"
        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
      />
    </div>
    <div className="text-xs">
      <label htmlFor="offers">{name}</label>
    </div>
  </div>
)

export default SimpleCheckbox
