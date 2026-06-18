import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconDots,
  IconMusic,
  IconLoader2,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2]

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

type AudioPlayerProps = {
  src: string
  mediaType: string
  filename?: string
  className?: string
}

export function AudioPlayer({
  src,
  mediaType,
  filename,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const isDraggingRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  // True while the clip is being prepared (data: → Blob conversion) or while
  // the media element is still buffering, so the user sees real progress on
  // large files instead of a dead button.
  const [isLoading, setIsLoading] = useState(true)
  // Some files (e.g. a large/edge-encoded FLAC) can't be decoded by WebKit even
  // though the model still receives them. Show a graceful fallback instead of a
  // dead 0:00/0:00 player.
  const [hasError, setHasError] = useState(false)
  // Large audio (e.g. a 20MB FLAC) becomes a ~27MB base64 data: URL, which
  // WebKit cannot reliably decode/play (throws NotSupportedError). Convert it
  // to a Blob URL — the standard, memory-friendly way to feed large media to a
  // media element. Non-data URLs (blob:, file:, http) are used as-is.
  const [playbackSrc, setPlaybackSrc] = useState<string | undefined>(() =>
    src.startsWith('data:') ? undefined : src
  )

  useEffect(() => {
    if (!src.startsWith('data:')) {
      setPlaybackSrc(src)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false

    fetch(src)
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPlaybackSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setPlaybackSrc(src)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onTime = () => {
      if (!isDraggingRef.current) setCurrentTime(el.currentTime)
    }
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration)
    }
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onReady = () => {
      setIsLoading(false)
      setHasError(false)
    }
    const onWaiting = () => setIsLoading(true)
    const onError = () => {
      setIsLoading(false)
      setHasError(true)
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('ended', onEnded)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('loadeddata', onReady)
    el.addEventListener('canplay', onReady)
    el.addEventListener('playing', onReady)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('error', onError)

    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('loadeddata', onReady)
      el.removeEventListener('canplay', onReady)
      el.removeEventListener('playing', onReady)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('error', onError)
    }
  }, [])

  useEffect(() => {
    const el = audioRef.current
    if (el && playbackSrc) {
      setIsLoading(true)
      setHasError(false)
      el.load()
    }
  }, [playbackSrc])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el || !playbackSrc) return
    if (el.paused) {
      void el.play().catch(() => setIsPlaying(false))
    } else {
      el.pause()
    }
  }, [playbackSrc])

  // Called on every pointer move while dragging — show position live without
  // seeking, so the thumb follows the finger without timeupdate fighting it.
  const handleSeekChange = useCallback((values: number[]) => {
    isDraggingRef.current = true
    setCurrentTime(values[0] ?? 0)
  }, [])

  // Called once when the user releases the thumb or clicks a point on the track.
  const handleSeekCommit = useCallback((values: number[]) => {
    isDraggingRef.current = false
    const next = values[0] ?? 0
    const el = audioRef.current
    if (el) el.currentTime = next
    setCurrentTime(next)
  }, [])

  const changeRate = useCallback((value: string) => {
    const next = parseFloat(value)
    setRate(next)
    const el = audioRef.current
    if (el) el.playbackRate = next
  }, [])

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5',
        className
      )}
    >
      {filename && (
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground truncate"
          title={filename}
        >
          <IconMusic size={14} className="shrink-0" />
          <span className="truncate">{filename}</span>
        </div>
      )}

      {hasError ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <IconAlertTriangle size={14} className="shrink-0" />
          <span>Can't preview this audio in the app</span>
        </div>
      ) : (
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!playbackSrc || (isLoading && !isPlaying)}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isLoading && !isPlaying ? (
            <IconLoader2 size={16} className="animate-spin" />
          ) : isPlaying ? (
            <IconPlayerPauseFilled size={16} />
          ) : (
            <IconPlayerPlayFilled size={16} />
          )}
        </button>

        <Slider
          value={[Math.min(currentTime, duration || 0)]}
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          onValueChange={handleSeekChange}
          onValueCommit={handleSeekCommit}
          aria-label="Seek"
          className="flex-1"
        />

        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Playback options"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <IconDots size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(rate)}
              onValueChange={changeRate}
            >
              {PLAYBACK_RATES.map((r) => (
                <DropdownMenuRadioItem key={r} value={String(r)}>
                  {r}×
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      )}

      <audio ref={audioRef} src={playbackSrc} preload="metadata" className="hidden">
        {playbackSrc && <source src={playbackSrc} type={mediaType} />}
      </audio>
    </div>
  )
}
