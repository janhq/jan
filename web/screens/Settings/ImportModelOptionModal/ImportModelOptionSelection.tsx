import { ModelImportOption, OptionType } from '@janhq/core'

type Props = {
  option: ModelImportOption
  checked: boolean
  setSelectedOptionType: (type: OptionType) => void
}

const ImportModelOptionSelection: React.FC<Props> = ({
  option,
  checked,
  setSelectedOptionType,
}) => (
  <div
    className="flex cursor-pointer flex-row"
    onClick={() => setSelectedOptionType(option.type)}
  >
    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#2563EB]">
      {checked && <div className="h-2 w-2 rounded-full bg-blue-500" />}
    </div>

    <div className="ml-2 flex-1">
      <p className="mb-2 text-sm font-medium">{option.title}</p>
      <p className="text-sm font-normal text-[#71717A]">{option.description}</p>
    </div>
  </div>
)

export default ImportModelOptionSelection
