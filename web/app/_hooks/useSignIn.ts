import { signIn } from 'next-auth/react'

export default function useSignIn() {
  const signInWithKeyCloak = () => {
    return signIn('keycloak')
  }

  return { signInWithKeyCloak }
}
