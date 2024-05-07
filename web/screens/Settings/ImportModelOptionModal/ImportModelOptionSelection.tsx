import { ModelImportOption, OptionType } from '@janhq/core'

type Props = {
  option: ModelImportOption
  checked: boolean
  setSelectedOptionType: (type: OptionType) => void
}

const ImportModelOptionSelection = ({
  option,
  checked,
  setSelectedOptionType,
}: Props) => (
  <div
    className="flex cursor-pointer flex-row"
    onClick={() => setSelectedOptionType(option.type)}
  >
    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[hsla(var(--primary-bg))]">
      {checked && (
        <div className="h-2 w-2 rounded-full bg-[hsla(var(--primary-bg))]" />
      )}
    </div>
    <div className="ml-2 flex-1">
      <p className="mb-2 font-medium">{option.title}</p>
      <p className="font-normal text-[hasla(var(--text-secondary))]">
        {option.description}
      </p>
    </div>
  </div>
)

export default ImportModelOptionSelection
