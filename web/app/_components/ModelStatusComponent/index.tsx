import React from 'react'

export type ModelStatusType = {
  title: string
  textColor: string
  backgroundColor: string
}

export enum ModelStatus {
  Installed,
  Active,
  RunningInNitro,
}

export const ModelStatusMapper: Record<ModelStatus, ModelStatusType> = {
  [ModelStatus.Installed]: {
    title: 'Installed',
    textColor: 'text-black',
    backgroundColor: 'bg-gray-200 text-gray-600',
  },
  [ModelStatus.Active]: {
    title: 'Active',
    textColor: 'text-green-600',
    backgroundColor: 'bg-green-100 dark:bg-green-300',
  },
  [ModelStatus.RunningInNitro]: {
    title: 'Running in Nitro',
    textColor: 'text-green-600',
    backgroundColor: 'bg-green-100 dark:bg-green-300',
  },
}

type Props = {
  status: ModelStatus
}

export const ModelStatusComponent: React.FC<Props> = ({ status }) => {
  const statusType = ModelStatusMapper[status]
  return (
    <div
      className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${statusType.backgroundColor}`}
    >
      {statusType.title}
    </div>
  )
}
