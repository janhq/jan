export type SpeakOptions = {
  lang?: string
  rate?: number
  pitch?: number
  volume?: number
  voiceName?: string
}

let currentUtterance: SpeechSynthesisUtterance | null = null

export function isSpeaking() {
  return Boolean(currentUtterance) && window.speechSynthesis.speaking
}

export function stop() {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel()
  }
  currentUtterance = null
}

export async function getVoices(): Promise<SpeechSynthesisVoice[]> {
  // Some browsers load voices asynchronously. Wait for them if necessary.
  const voices = window.speechSynthesis.getVoices()
  if (voices.length) return voices

  return new Promise((resolve) => {
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)

    // fallback timeout in case the event never fires
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(window.speechSynthesis.getVoices())
    }, 1500)
  })
}
function cleanText(text: string) {
  const ttsReadableChars = [
    '*', '/', '\\', '@', '#', '$', '%', '&',
    '+', '=', '(', ')', '[', ']', '{', '}', '"', "'", '^', '_', '~',
    '<', '>', '|', '--'
  ];
  const ttsRegex = new RegExp(`[${ttsReadableChars.map(c => '\\' + c).join('')}]`, 'g');
  const unicodeRegex = "/[^\u0000-\u007F]/g";
  return text
    .replace(ttsRegex, '')    
    .replace(unicodeRegex, '') 
    .trim(); 

}
export async function speak(text: string, opts: SpeakOptions = {}) {
  if (!text) return Promise.reject(new Error('No text provided'))
  const cleanedText = cleanText(text)
    
    
  stop()
    
  const utterance = new SpeechSynthesisUtterance(cleanedText)
  if (opts.lang) utterance.lang = opts.lang
  if (typeof opts.rate === 'number') utterance.rate = opts.rate
  if (typeof opts.pitch === 'number') utterance.pitch = opts.pitch
  if (typeof opts.volume === 'number') utterance.volume = opts.volume

  if (opts.voiceName) {
    const voices = await getVoices()
    const v = voices.find((vv) => vv.name === opts.voiceName || vv.voiceURI === opts.voiceName)
    if (v) utterance.voice = v
  }

  currentUtterance = utterance

  return new Promise<void>((resolve) => {
    utterance.onend = () => {
      if (currentUtterance === utterance) currentUtterance = null
      resolve()
    }
    utterance.onerror = () => {
      if (currentUtterance === utterance) currentUtterance = null
      resolve()
    }
    window.speechSynthesis.speak(utterance)
  })
}
