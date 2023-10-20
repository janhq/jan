import React from 'react'

type Props = {
  title: string
}

const ModelTableHeader: React.FC<Props> = ({ title }) => (
  <th
    scope="col"
    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 first:rounded-tl-lg last:rounded-tr-lg"
  >
    {title}
  </th>
)

export default React.memo(ModelTableHeader)
