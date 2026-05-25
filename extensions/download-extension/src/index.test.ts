import { describe, expect, it } from 'vitest'

import { buildAuthHeaders, isHuggingFaceUrl } from './index'

describe('isHuggingFaceUrl', () => {
  it.each([
    'https://huggingface.co/Qwen/Qwen2-7B/resolve/main/model.safetensors',
    'https://HUGGINGFACE.CO/foo/bar',
    'https://cdn-lfs.huggingface.co/repos/aa/bb/cc/file.gguf',
    'https://hf.co/foo/bar',
    'https://cdn.hf.co/something',
  ])('returns true for HF host %s', (url) => {
    expect(isHuggingFaceUrl(url)).toBe(true)
  })

  it.each([
    'https://github.com/ggml-org/llama.cpp/releases/download/b9284/llama-b9284-bin-win-cuda-13.1-x64.zip',
    'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest',
    'https://huggingface.co.evil.example.com/foo',
    'https://example.com/huggingface.co/foo',
    'https://s3.amazonaws.com/hf-models/foo',
    'not a url',
    '',
  ])('returns false for non-HF input %s', (url) => {
    expect(isHuggingFaceUrl(url)).toBe(false)
  })
})

describe('buildAuthHeaders', () => {
  const HF_URL = 'https://huggingface.co/Qwen/Qwen2-7B/resolve/main/x.gguf'
  const HF_CDN_URL = 'https://cdn-lfs.huggingface.co/repos/aa/bb/cc/x.gguf'
  const GH_URL =
    'https://github.com/ggml-org/llama.cpp/releases/download/b9284/llama-b9284-bin-win-cuda-13.1-x64.zip'

  it('returns empty headers when no HF token is configured', () => {
    expect(buildAuthHeaders([{ url: HF_URL }], undefined)).toEqual({})
    expect(buildAuthHeaders([{ url: HF_URL }], null)).toEqual({})
    expect(buildAuthHeaders([{ url: HF_URL }], '')).toEqual({})
  })

  it('returns empty headers for an empty batch even with a token', () => {
    expect(buildAuthHeaders([], 'hf_secret')).toEqual({})
  })

  it('attaches the bearer token when every URL is on a HF host', () => {
    expect(
      buildAuthHeaders([{ url: HF_URL }, { url: HF_CDN_URL }], 'hf_secret')
    ).toEqual({ Authorization: 'Bearer hf_secret' })
  })

  // The bug we are fixing: HF token must NOT be sent to GitHub releases.
  it('drops the token for a GitHub-only batch', () => {
    expect(buildAuthHeaders([{ url: GH_URL }], 'hf_secret')).toEqual({})
  })

  // Mixed batches are conservatively treated as non-HF: dropping the token
  // is the safe choice (no credential leak). No call site currently mixes
  // HF and non-HF URLs in a single batch — see audit in the bug report.
  it('drops the token for a mixed HF + GitHub batch', () => {
    expect(
      buildAuthHeaders([{ url: HF_URL }, { url: GH_URL }], 'hf_secret')
    ).toEqual({})
  })

  it('drops the token for a malformed URL in the batch', () => {
    expect(
      buildAuthHeaders([{ url: HF_URL }, { url: 'not a url' }], 'hf_secret')
    ).toEqual({})
  })
})
