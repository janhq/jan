import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseOllamaSearchHtml,
  parseOllamaTagsHtml,
  resolveOllamaBlob,
  buildOllamaQuantId,
  buildOllamaQuantPath,
} from '../ollama'

describe('ollama service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds sanitized quant ids and ollama:// paths', () => {
    expect(buildOllamaQuantId('llama3.2', '1b-instruct-q4_K_M')).toBe(
      'ollama/llama3_2-1b-instruct-q4_K_M'
    )
    expect(buildOllamaQuantPath('llama3.2', '1b')).toBe(
      'ollama://library/llama3.2:1b'
    )
  })

  it('parses ollama.com/search HTML cards and skips cloud-only entries', () => {
    const html = `
      <ul>
        <li>
          <a href="/library/llama3.2">
            <div>
              <h2 title="llama3.2"><span>llama3.2</span></h2>
              <span title="Updated September 25, 2024">2y</span>
            </div>
            <div><span class="bg-indigo-50">tools</span></div>
            <p>Meta's Llama 3.2 goes small with 1B and 3B models.</p>
            <div>
              <span title="88,102,206 downloads"><span>88.1M</span></span>
              <span class="bg-[#ddf4ff] text-blue-600">1b</span>
              <span class="bg-[#ddf4ff] text-blue-600">3b</span>
            </div>
          </a>
        </li>
        <li>
          <a href="/library/cloud-only-model">
            <div><h2 title="cloud-only-model"><span>cloud-only-model</span></h2></div>
            <div><span class="bg-cyan-50">cloud</span></div>
            <p>Cloud only model.</p>
          </a>
        </li>
      </ul>
    `

    const models = parseOllamaSearchHtml(html)
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      model_name: 'ollama/llama3.2',
      display_name: 'llama3.2',
      developer: 'ollama',
      downloads: 88102206,
      tools: true,
      source: 'ollama',
    })
    expect(models[0].quants).toHaveLength(2)
    expect(models[0].quants?.[0]).toEqual({
      model_id: 'ollama/llama3_2-1b',
      path: 'ollama://library/llama3.2:1b',
      file_size: '',
    })
  })

  it('parses ollama.com/library/<slug>/tags HTML and skips cloud tags', () => {
    const html = `
      <div>
        <div class="grid">
          <a href="/library/llama3.2:1b">llama3.2:1b</a>
          <span>1.3GB</span>
        </div>
        <div class="grid">
          <a href="/library/llama3.2:3b-instruct-q4_K_M">llama3.2:3b-instruct-q4_K_M</a>
          <span>2.0GB</span>
        </div>
        <div class="grid">
          <a href="/library/llama3.2:cloud">llama3.2:cloud</a>
          <span>0B</span>
        </div>
      </div>
    `

    const quants = parseOllamaTagsHtml(html, 'llama3.2')
    expect(quants).toEqual([
      {
        model_id: 'ollama/llama3_2-1b',
        path: 'ollama://library/llama3.2:1b',
        file_size: '1.3 GB',
      },
      {
        model_id: 'ollama/llama3_2-3b-instruct-q4_K_M',
        path: 'ollama://library/llama3.2:3b-instruct-q4_K_M',
        file_size: '2.0 GB',
      },
    ])
  })

  it('resolves ollama:// manifest into GGUF and optional projector blob URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        layers: [
          {
            mediaType: 'application/vnd.ollama.image.model',
            digest: 'sha256:abc123',
            size: 2019377376,
          },
          {
            mediaType: 'application/vnd.ollama.image.projector',
            digest: 'sha256:def456',
            size: 5000000,
          },
        ],
      }),
    } as Response)

    const resolved = await resolveOllamaBlob('ollama://library/llama3.2:latest')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.ollama.ai/v2/library/llama3.2/manifests/latest',
      expect.objectContaining({
        headers: {
          Accept: 'application/vnd.docker.distribution.manifest.v2+json',
        },
      })
    )
    expect(resolved).toEqual({
      modelPath: 'https://registry.ollama.ai/v2/library/llama3.2/blobs/sha256:abc123',
      modelSha256: 'abc123',
      modelSize: 2019377376,
      mmprojPath: 'https://registry.ollama.ai/v2/library/llama3.2/blobs/sha256:def456',
      mmprojSha256: 'def456',
      mmprojSize: 5000000,
    })
  })
})
