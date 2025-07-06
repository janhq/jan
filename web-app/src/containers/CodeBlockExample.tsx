import { RenderMarkdown } from './RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'

const EXAMPLE_CODE = `\`\`\`typescript
// Example code for preview
function greeting(name: string) {
  return \`Hello, \${name}!\`;
}

// Call the function
const message = greeting('Jan');
console.log(message);  // Outputs: Hello, Jan!
\`\`\``

export function CodeBlockExample() {
  const { t } = useTranslation()
  return (
    <div className="w-full overflow-hidden border border-main-view-fg/10 rounded-md my-2">
      <div className="flex items-center justify-between px-4 py-2 bg-main-view-fg/10">
        <span className="font-medium text-xs font-sans">{t('preview')}</span>
      </div>
      <div className="overflow-auto p-2">
        <RenderMarkdown content={EXAMPLE_CODE} />
      </div>
    </div>
  )
}
