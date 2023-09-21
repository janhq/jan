import { getSession } from "next-auth/react";

export async function getAccessToken() {
  const session = await getSession();
  if (session) {
    // @ts-ignore
    return session.access_token;
  }
  return null;
}

export async function getIdToken() {
  const session = await getSession();
  if (session) {
    // @ts-ignore
    return session.id_token;
  }
  return null;
}
