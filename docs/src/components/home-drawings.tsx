// Docs home tiles: simplified drawings of the app and the terminal agent.
// Drawn in code (not screenshots) so they never go stale and follow the
// theme. White glass line art, drawn to sit on a brand gradient.

const WINDOW = 'fill-white/15 stroke-white/50'
const DETAIL = 'fill-white/60'
const SOFT = 'fill-white/25'
const ACCENT = 'fill-white'
const RULE = 'stroke-white/40'

function Dots() {
  return (
    <>
      <circle cx="20" cy="18" r="3" className={DETAIL} />
      <circle cx="30" cy="18" r="3" className={DETAIL} />
      <circle cx="40" cy="18" r="3" className={DETAIL} />
    </>
  )
}

/** Jan Desktop: the app window, with the sidebar, a question and an answer. */
export function DesktopDrawing() {
  return (
    <svg viewBox="0 0 320 180" aria-hidden className="w-full max-w-[320px]">
      <rect x="0.5" y="0.5" width="319" height="179" rx="12" className={WINDOW} />
      <Dots />
      <line x1="88" y1="34" x2="88" y2="179.5" className={RULE} />
      {/* Sidebar */}
      <rect x="14" y="42" width="60" height="8" rx="4" className={SOFT} />
      <rect x="14" y="58" width="48" height="6" rx="3" className={DETAIL} />
      <rect x="14" y="72" width="56" height="6" rx="3" className={DETAIL} />
      <rect x="14" y="86" width="40" height="6" rx="3" className={DETAIL} />
      {/* Chat: question on the right, answer on the left */}
      <rect x="200" y="44" width="104" height="22" rx="11" className={ACCENT} />
      <rect x="104" y="80" width="150" height="6" rx="3" className={DETAIL} />
      <rect x="104" y="94" width="180" height="6" rx="3" className={DETAIL} />
      <rect x="104" y="108" width="120" height="6" rx="3" className={DETAIL} />
      {/* Message box */}
      <rect x="104" y="138" width="200" height="28" rx="8" className={SOFT} />
      <circle cx="290" cy="152" r="7" className={ACCENT} />
    </svg>
  )
}

/** Jan Agent: a terminal running a task, steps ticked off, cursor waiting. */
export function AgentDrawing() {
  const tick = (y: number) => (
    <path
      d={`M14 ${y} l3 3 l6 -6`}
      fill="none"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-white"
    />
  )
  return (
    <svg viewBox="0 0 320 180" aria-hidden className="w-full max-w-[320px]">
      <rect x="0.5" y="0.5" width="319" height="179" rx="12" className={WINDOW} />
      <Dots />
      <line x1="0.5" y1="34" x2="319.5" y2="34" className={RULE} />
      {/* Prompt */}
      <path
        d="M14 48 l6 5 l-6 5"
        fill="none"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-white"
      />
      <rect x="28" y="50" width="150" height="6" rx="3" className={DETAIL} />
      {/* Steps done */}
      {tick(76)}
      <rect x="30" y="74" width="120" height="6" rx="3" className={SOFT} />
      {tick(96)}
      <rect x="30" y="94" width="168" height="6" rx="3" className={SOFT} />
      {tick(116)}
      <rect x="30" y="114" width="96" height="6" rx="3" className={SOFT} />
      {/* Cursor */}
      <path
        d="M14 140 l6 5 l-6 5"
        fill="none"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-white"
      />
      <rect x="28" y="138" width="8" height="14" rx="1" className={ACCENT} />
    </svg>
  )
}
