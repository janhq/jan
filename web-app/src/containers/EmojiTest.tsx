import { RenderMarkdown } from './RenderMarkdown'

export function EmojiTest() {
  const testContent = `
# Emoji Test

This is a test of emoji rendering:

- Thumbs up: :thumbsup:
- Book: :book:
- Smile: :smile:
- Heart: :heart:
- Check: :white_check_mark:

Using Unicode directly: 👍 📚 😄 ❤️ ✅
`

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Emoji Rendering Test</h1>
      <div className="border p-4 rounded">
        <RenderMarkdown content={testContent} />
      </div>
    </div>
  )
}
