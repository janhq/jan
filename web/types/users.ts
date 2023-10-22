enum Role {
  User = 'user',
  Assistant = 'assistant',
}

interface User {
  id: string
  displayName: string
  avatarUrl: string
  email?: string
}
