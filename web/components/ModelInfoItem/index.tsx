import React from 'react'

type Props = {
  name: string
  description: string
}

const ModelInfoItem: React.FC<Props> = ({ description, name }) => (
  <div className="flex flex-1 flex-col">
    <span className="text-sm font-normal text-gray-500">{name}</span>
    <span className="text-sm font-normal">{description}</span>
  </div>
)

export default React.memo(ModelInfoItem)
