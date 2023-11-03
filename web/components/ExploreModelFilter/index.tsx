import SearchBar from '../SearchBar'
import SimpleCheckbox from '../SimpleCheckbox'
import SimpleTag from '../SimpleTag'
import { TagType } from '../SimpleTag/TagType'

const tags = [
  'Roleplay',
  'Llama',
  'Story',
  'Casual',
  'Professional',
  'CodeLlama',
  'Coding',
]
const checkboxs = ['GGUF', 'TensorRT', 'Meow', 'JigglyPuff']

const ExploreModelFilter: React.FC = () => {
  const enabled = true
  if (!enabled) return null

  return (
    <div className="w-64">
      <h2 className="mb-[15px] text-xs font-semibold">Tags</h2>
      <SearchBar placeholder="Filter by tags" />
      <div className="mt-[14px] flex flex-wrap gap-[9px]">
        {tags.map((item) => (
          <SimpleTag key={item} title={item} type={item as TagType} />
        ))}
      </div>
      <hr className="my-10" />
      <fieldset>
        {checkboxs.map((item) => (
          <SimpleCheckbox key={item} name={item} />
        ))}
      </fieldset>
    </div>
  )
}

export default ExploreModelFilter
