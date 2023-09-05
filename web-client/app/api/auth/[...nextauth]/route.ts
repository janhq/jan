// @ts-nocheck
import NextAuth from "next-auth/next";
import KeycloakProvider from "next-auth/providers/keycloak";
import jwt_decode from "jwt-decode";

async function refreshAccessToken(token) {
  const resp = await fetch(`${process.env.REFRESH_TOKEN_URL}`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.KEYCLOAK_CLIENT_ID,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
    method: "POST",
  });
  const refreshToken = await resp.json();
  if (!resp.ok) throw refreshToken;
  return {
    ...token,
    access_token: refreshToken.access_token,
    decoded: jwt_decode(refreshToken.access_token),
    id_token: refreshToken.id_token,
    expired_at: Math.floor(Date.now() / 1000) + refreshToken.expired_in,
    refresh_token: refreshToken.refresh_token,
  };
}

export const authOptions = {
  providers: [
    KeycloakProvider({
      clientId: `${process.env.KEYCLOAK_CLIENT_ID}`,
      clientSecret: `${process.env.KEYCLOAK_CLIENT_SECRET}`,
      issuer: `${process.env.AUTH_ISSUER}`,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      const nowTimestamp = Math.floor(Date.now() / 1000);
      if (account) {
        token.decoded = jwt_decode(account.id_token);
        token.access_token = account.access_token;
        token.id_token = account.id_token;
        token.expires_at = account.expires_at;
        token.refresh_token = account.refresh_token;
        return token;
      } else if (nowTimestamp < token.expires_at) {
        return token;
      } else {
        console.log("token is expired, refresh it");
        try {
          const refreshedToken = await refreshAccessToken(token);
          console.log("token is refreshed");
          return refreshedToken;
        } catch (e) {
          console.error("Error refreshing access token", e);
          return { ...token, error: "RefreshAccessTokenError" };
        }
      }
    },
    async session({ session, token }) {
      session.access_token = token.access_token;
      session.id_token = token.id_token;
      session.user.user_id = token.sub;
      session.error = token.error;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
