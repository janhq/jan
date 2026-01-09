interface GuestLoginResponse {
  access_token: string;
  expires_in: number;
  principal_id: string;
  refresh_token: string;
  token_type: string;
  user_id: string;
  username: string;
}

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * OAuth 2.0 token response from Keycloak
 * Follows OpenID Connect specification
 */
interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in: number;
  scope: string;
}

/**
 * OAuth state data stored during authorization flow
 */
interface OAuthStateData {
  state: string;
  codeVerifier: string;
  redirectUrl?: string;
}
