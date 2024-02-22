export const JanApiRouteConfiguration: Record<string, RouteConfiguration> = {
  models: {
    dirName: 'models',
    metadataFileName: 'model.json',
    delete: {
      object: 'model',
    },
  },
  assistants: {
    dirName: 'assistants',
    metadataFileName: 'assistant.json',
    delete: {
      object: 'assistant',
    },
  },
  threads: {
    dirName: 'threads',
    metadataFileName: 'thread.json',
    delete: {
      object: 'thread',
    },
  },
}

export type RouteConfiguration = {
  dirName: string
  metadataFileName: string
  delete: {
    object: string
  }
}
