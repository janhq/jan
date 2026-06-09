import { describe, expect, it } from 'vitest'
import {
  accessTokenIsExpiring,
  buildAuthorizeUrl,
  parseOAuthCallbackInput,
} from '@/lib/xai-oauth-client'

describe('xai-oauth-client', () => {
  it('buildAuthorizeUrl includes required OAuth params', async () => {
    const pkce = {
      verifier: 'test-verifier',
      challenge: 'test-challenge',
    }
    const url = buildAuthorizeUrl(pkce, 'test-state')
    expect(url).toContain('https://auth.x.ai/oauth2/authorize')
    expect(url).toContain('plan=generic')
    expect(url).toContain('referrer=jan')
    expect(url).toContain('test-challenge')
    expect(url).toContain('test-state')
  })

  it('parseOAuthCallbackInput accepts raw authorization codes', () => {
    const parsed = parseOAuthCallbackInput(
      'Id13pPcuznfZX94phdRn6ygiB88payGnrcR9ceqf4WJO2RShWKKCf5O0Y8G-mRFypBMlonXC4RX1tsE6-0UeTA'
    )
    expect(parsed.state).toBeNull()
    expect(parsed.code).toContain('Id13pPcuznfZX94phdRn6ygiB88payGnrcR9ceqf4WJO2RShWKKCf5O0Y8G')
  })

  it('accessTokenIsExpiring detects near-expiry JWTs', () => {
    const exp = Math.floor(Date.now() / 1000) + 30
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const token = `header.${payload}.signature`
    expect(accessTokenIsExpiring(token, 120_000)).toBe(true)
  })
})