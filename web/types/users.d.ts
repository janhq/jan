export enum Role {
  User = 'user',
  Assistant = 'assistant',
}

type User = {
  id: string
  displayName: string
  avatarUrl: string
  email?: string
}
