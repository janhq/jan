import { useEffect } from 'react'

const Umami = () => {
  useEffect(() => {
    if (!VERSION || !ANALYTICS_HOST || !ANALYTICS_ID) return
    fetch(ANALYTICS_HOST, {
      method: 'POST',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          website: ANALYTICS_ID,
          hostname: 'jan.ai',
          screen: `${screen.width}x${screen.height}`,
          language: navigator.language,
          referrer: 'index.html',
          data: { version: VERSION },
          type: 'event',
          title: document.title,
          url: 'index.html',
          name: VERSION,
        },
        type: 'event',
      }),
    })
  }, [])

  return <></>
}

export default Umami
