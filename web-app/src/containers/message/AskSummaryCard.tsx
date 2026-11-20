import { useTranslation } from '@/i18n/react-i18next-compat'
import type { AskSummaryRow } from '@/lib/coworkAsk'

/**
 * A settled `ask`, kept in the transcript so the user's answers stay visible
 * once the card above the input closes. It replaces the tool call's entry in
 * the reasoning trace (MessageItem skips the part after rendering this).
 */
export function AskSummaryCard({ rows }: { rows: AskSummaryRow[] }) {
  const { t } = useTranslation()
  return (
    <div className="my-2 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col gap-1">
          <p className="text-main-view-fg/60">{row.question}</p>
          {row.answer === null ? (
            <p className="text-main-view-fg/55">{t('common:askSkipped')}</p>
          ) : (
            <p className="whitespace-pre-wrap">{row.answer}</p>
          )}
        </div>
      ))}
    </div>
  )
}
