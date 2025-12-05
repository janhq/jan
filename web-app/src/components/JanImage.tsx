import { useState, useEffect } from 'react'
import { mediaService } from '@jan/extensions-web'
import { cn } from '@/lib/utils'
import { IconLoader2, IconPhotoOff } from '@tabler/icons-react'

interface JanImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    containerClassName?: string
}

export const JanImage = ({
    src,
    alt,
    className,
    containerClassName,
    ...props
}: JanImageProps) => {
    const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined)
    const [error, setError] = useState(false)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        // If no src, nothing to do
        if (!src) {
            setResolvedSrc(undefined)
            return
        }

        // Check if it's a special jan_id encoded in data URL
        // Format: data:mime/type;jan_id
        // regex: ^data:[^;]+;(jan_[a-zA-Z0-9]+)$
        const janIdMatch = src.match(/^data:[^;]+;(jan_[a-zA-Z0-9_]+)$/)

        if (janIdMatch && janIdMatch[1]) {
            const janId = janIdMatch[1]
            setLoading(true)
            setError(false)

            // Fetch presigned URL
            mediaService
                .getPresignedUrl(janId)
                .then((response) => {
                    setResolvedSrc(response.url)
                })
                .catch((err) => {
                    console.error('Failed to resolve jan_id image:', err)
                    setError(true)
                })
                .finally(() => {
                    setLoading(false)
                })
        } else {
            // Normal image
            setResolvedSrc(src)
            setLoading(false)
            setError(false)
        }
    }, [src])

    if (error) {
        return (
            <div
                className={cn(
                    "flex items-center justify-center bg-muted text-muted-foreground",
                    className,
                    containerClassName
                )}
                title="Failed to load image"
            >
                <IconPhotoOff size={20} />
            </div>
        )
    }

    if (loading) {
        return (
            <div
                className={cn(
                    "flex items-center justify-center bg-muted/50",
                    className,
                    containerClassName
                )}
            >
                <IconLoader2 className="animate-spin text-muted-foreground" size={20} />
            </div>
        )
    }

    return (
        <img
            src={resolvedSrc}
            alt={alt}
            className={className}
            onError={() => setError(true)}
            {...props}
        />
    )
}
