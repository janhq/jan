import React from 'react'

type Props = {
  title: string
}

const ModelTableHeader: React.FC<Props> = ({ title }) => (
  <th
    scope="col"
    className="text-muted-foreground border-b border-border p-3 text-left text-xs font-semibold uppercase first:rounded-tl-lg last:rounded-tr-lg last:text-right"
  >
    {title}
  </th>
)

export default React.memo(ModelTableHeader)
