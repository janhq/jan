interface GuestLoginResponse {
  access_token: string
  expires_in: number
  principal_id: string
  refresh_token: string
  token_type: string
  user_id: string
  username: string
}

interface RefreshTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}
