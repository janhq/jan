import { describe, it, expect } from 'vitest'
import {
  encodeVideoSentinel,
  hasVideoSentinel,
  splitVideoSentinels,
  parseVideoDataUrl,
} from '../video-sentinel'
import { encodeAudioSentinel } from '../audio-sentinel'
import {
  decodeVideoSentinelsInBody,
  decodeAudioSentinelsInBody,
} from '../model-factory'

describe('video-sentinel', () => {
  it('round-trips a single sentinel back to an input_video part', () => {
    const encoded = encodeVideoSentinel('QUFB')
    expect(hasVideoSentinel(encoded)).toBe(true)
    expect(splitVideoSentinels(encoded)).toEqual([
      { type: 'input_video', input_video: { data: 'QUFB' } },
    ])
  })

  it('preserves surrounding text and ordering', () => {
    const encoded = `hello${encodeVideoSentinel('WlpaWg==')}world`
    expect(splitVideoSentinels(encoded)).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'input_video', input_video: { data: 'WlpaWg==' } },
      { type: 'text', text: 'world' },
    ])
  })

  it('returns null for plain text', () => {
    expect(splitVideoSentinels('just a message')).toBeNull()
  })

  it('parses video data URLs across container MIME types', () => {
    expect(parseVideoDataUrl('data:video/mp4;base64,QUFB')).toEqual({ data: 'QUFB' })
    expect(parseVideoDataUrl('data:video/quicktime;base64,WlpaWg==')).toEqual({
      data: 'WlpaWg==',
    })
    expect(parseVideoDataUrl('data:image/png;base64,XXXX')).toBeNull()
  })

  describe('decodeVideoSentinelsInBody', () => {
    it('rewrites a bare-string user content to input_video + text parts', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: `describe: ${encodeVideoSentinel('QUFB')}`,
          },
        ],
      }
      decodeVideoSentinelsInBody(body)
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'describe: ' },
        { type: 'input_video', input_video: { data: 'QUFB' } },
      ])
    })

    it('ignores assistant messages even if they accidentally match', () => {
      const body = {
        messages: [
          { role: 'assistant', content: encodeVideoSentinel('QUFB') },
        ],
      }
      decodeVideoSentinelsInBody(body)
      expect(body.messages[0].content).toBe(encodeVideoSentinel('QUFB'))
    })

    it('co-exists with audio decode in the same body (disjoint markers)', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: `q ${encodeAudioSentinel('mp3', 'QUFB')}${encodeVideoSentinel('WlpaWg==')}`,
          },
        ],
      }
      decodeAudioSentinelsInBody(body)
      decodeVideoSentinelsInBody(body)
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'q ' },
        { type: 'input_audio', input_audio: { data: 'QUFB', format: 'mp3' } },
        { type: 'input_video', input_video: { data: 'WlpaWg==' } },
      ])
    })
  })
})
