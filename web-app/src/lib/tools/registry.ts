import type { ToolPresentation } from './types'
import { presentWebFetchExa } from './presenters/web-fetch-exa'
import { presentWebSearchExa } from './presenters/web-search-exa'
import { presentGenericTool } from './presenters/generic'

type PresenterArgs = {
  toolName: string
  input?: unknown
  output?: unknown
  errorText?: string
  state: string
}

type ToolPresenter = (args: PresenterArgs) => ToolPresentation

const presenters: Record<string, ToolPresenter> = {
  web_search_exa: presentWebSearchExa,
  web_fetch_exa: presentWebFetchExa,
}

export function presentTool(args: PresenterArgs): ToolPresentation {
  const presenter = presenters[args.toolName]
  if (presenter) return presenter(args)
  return presentGenericTool(args)
}
