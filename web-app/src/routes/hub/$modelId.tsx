import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/hub/$modelId')({
  component: HubModelDetailRedirect,
})

function HubModelDetailRedirect() {
  const navigate = useNavigate()
  const { modelId } = useParams({ from: Route.id })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useSearch({ from: Route.id as any })

  useEffect(() => {
    navigate({
      to: '/marketplace/$modelId',
      params: { modelId },
      search,
    })
  }, [navigate, modelId, search])

  return (
    <div className="flex items-center justify-center h-svh w-full">
      <span className="text-muted-foreground">正在跳转...</span>
    </div>
  )
}
