import { describe, it, expect } from 'vitest'
import {
  encodeAudioSentinel,
  hasAudioSentinel,
  splitAudioSentinels,
  parseAudioDataUrl,
} from '../audio-sentinel'
import { decodeAudioSentinelsInBody } from '../model-factory'

describe('audio-sentinel', () => {
  it('round-trips a single sentinel back to an input_audio part', () => {
    const encoded = encodeAudioSentinel('mp3', 'QUFB')
    expect(hasAudioSentinel(encoded)).toBe(true)
    expect(splitAudioSentinels(encoded)).toEqual([
      { type: 'input_audio', input_audio: { data: 'QUFB', format: 'mp3' } },
    ])
  })

  it('preserves surrounding text and ordering', () => {
    const encoded = `hello${encodeAudioSentinel('wav', 'WlpaWg==')}world`
    expect(splitAudioSentinels(encoded)).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'input_audio', input_audio: { data: 'WlpaWg==', format: 'wav' } },
      { type: 'text', text: 'world' },
    ])
  })

  it('returns null for plain text', () => {
    expect(splitAudioSentinels('just a message')).toBeNull()
  })

  it('parses audio data URLs', () => {
    expect(parseAudioDataUrl('data:audio/mpeg;base64,QUFB')).toEqual({ format: 'mp3', data: 'QUFB' })
    expect(parseAudioDataUrl('data:audio/wav;base64,WlpaWg==')).toEqual({
      format: 'wav',
      data: 'WlpaWg==',
    })
    expect(parseAudioDataUrl('data:image/png;base64,XXXX')).toBeNull()
  })

  describe('decodeAudioSentinelsInBody', () => {
    it('rewrites a bare-string user content to input_audio + text parts', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: `transcribe: ${encodeAudioSentinel('mp3', 'QUFB')}`,
          },
        ],
      }
      decodeAudioSentinelsInBody(body)
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'transcribe: ' },
        { type: 'input_audio', input_audio: { data: 'QUFB', format: 'mp3' } },
      ])
    })

    it('rewrites array content with a sentinel-bearing text part', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hi' },
              { type: 'text', text: encodeAudioSentinel('wav', 'WlpaWg==') },
            ],
          },
        ],
      }
      decodeAudioSentinelsInBody(body)
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'hi' },
        { type: 'input_audio', input_audio: { data: 'WlpaWg==', format: 'wav' } },
      ])
    })

    it('leaves bodies without sentinels untouched', () => {
      const body = {
        messages: [{ role: 'user', content: 'hello world' }],
      }
      decodeAudioSentinelsInBody(body)
      expect(body.messages[0].content).toBe('hello world')
    })

    it('ignores assistant messages even if they accidentally match', () => {
      const body = {
        messages: [
          { role: 'assistant', content: encodeAudioSentinel('mp3', 'QUFB') },
        ],
      }
      decodeAudioSentinelsInBody(body)
      expect(body.messages[0].content).toBe(encodeAudioSentinel('mp3', 'QUFB'))
    })
  })
})
