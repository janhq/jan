type Props = {
  title: string
  description?: string
  disabled?: boolean
  onChange?: (text?: string) => void
}

export default function ItemCardSidebar({
  description,
  title,
  disabled,
  onChange,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span>{title}</span>
      </div>
      <input
        value={description}
        disabled={disabled}
        type="text"
        className="block w-full rounded-md border-0 px-1 py-1.5 text-white shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        placeholder=""
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}
