# Vision/Image Processing in Jan Extensions-Web

## Overview

This document outlines how images are attached and processed as "vision" capabilities in the Jan extensions-web codebase. The system supports multimodal AI through image uploads and processing for compatible models.

## Architecture Components

### 1. Core Type Definitions

#### Content Types (`core/src/types/message/messageEntity.ts`)
```typescript
export enum ContentType {
  Text = 'text',
  Image = 'image_url',
}

export type ImageContentValue = {
  detail?: string
  url?: string
}

export type ThreadContent = {
  type: ContentType
  image_url?: ImageContentValue
  // ... other fields
}
```

#### Attachment Types (`web-app/src/types/attachment.ts`)
```typescript
export type Attachment = {
  name: string
  type: 'image' | 'document'
  
  // Image-specific fields
  base64?: string          // Base64 encoded image data
  dataUrl?: string         // Data URL for display
  mimeType?: string        // MIME type (image/jpeg, image/png, etc.)
  
  // Processing state
  processing?: boolean     // Currently being processed
  processed?: boolean      // Processing completed
  id?: string             // Generated ID after processing
  size?: number           // File size in bytes
}
```

### 2. Vision Capability Detection

#### Model Capabilities (`web-app/src/types/models.ts`)
```typescript
export enum ModelCapabilities {
  VISION = 'vision',
  // ... other capabilities
}
```

#### Vision Detection Logic (`jan-provider-web/api.ts`)
```typescript
private deriveCapabilitiesFromParameters(parameters: string[]): string[] {
  const capabilities = new Set<string>()
  
  if (parameters.includes('vision')) {
    capabilities.add('vision')
  }
  
  return Array.from(capabilities)
}
```

#### MMPROJ Support Detection (`web-app/src/containers/ChatInput.tsx`)
```typescript
// Check for mmproj existence or vision capability when model changes
useEffect(() => {
  if (selectedModel?.id) {
    if (selectedModel.capabilities?.includes('vision')) {
      setHasMmproj(true)
    } else {
      // Check for mmproj file existence for local models
      serviceHub.models().checkMmprojExists(selectedModel.id)
        .then(setHasMmproj)
        .catch(() => setHasMmproj(false))
    }
  } else {
    setHasMmproj(false)
  }
}, [selectedModel?.id, selectedModel?.capabilities, serviceHub])
```

## Image Attachment Workflow

### 1. Image Upload Sources

#### File Picker
```typescript
// Triggered by clicking the photo icon
const handleImagePickerClick = async () => {
  if (PlatformFeatures[PlatformFeature.FILE_MANAGEMENT]) {
    // Native file dialog (desktop)
    const files = await serviceHub.dialog().open({
      multiple: true,
      directory: false,
    })
    // Process selected files...
  } else {
    // Web file input fallback
    fileInputRef.current?.click()
  }
}
```

#### Drag & Drop
```typescript
const handleDrop = (e: React.DragEvent) => {
  e.preventDefault()
  setIsDragOver(false)
  
  const files = e.dataTransfer.files
  if (files && files.length > 0) {
    handleFileChange(syntheticEvent)
  }
}
```

#### Paste from Clipboard
```typescript
const handlePaste = async (e: React.ClipboardEvent) => {
  if (hasMmproj) {
    const clipboardItems = e.clipboardData?.items
    const imageItems = Array.from(clipboardItems).filter(item => 
      item.type.startsWith('image/')
    )
    
    imageItems.forEach(item => {
      const file = item.getAsFile()
      if (file) {
        processImageFiles([file])
      }
    })
  }
}
```

### 2. Image Processing Pipeline

#### File Validation & Processing
```typescript
const processImageFiles = async (files: File[]) => {
  const maxSize = 10 * 1024 * 1024 // 10MB limit
  const newFiles: Attachment[] = []
  
  for (const file of validFiles) {
    const detectedType = file.type || getFileTypeFromExtension(file.name)
    
    const reader = new FileReader()
    await new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') {
          const base64String = result.split(',')[1]
          const att = createImageAttachment({
            name: file.name,
            size: file.size,
            mimeType: detectedType,
            base64: base64String,
            dataUrl: result, // data:image/jpeg;base64,...
          })
          newFiles.push(att)
        }
        resolve()
      }
      reader.readAsDataURL(file)
    })
  }
  
  setAttachments(prev => [...prev, ...newFiles])
}
```

#### Image Ingestion Service (`web-app/src/services/uploads/default.ts`)
```typescript
export class DefaultUploadsService implements UploadsService {
  async ingestImage(_threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'image') {
      throw new Error('ingestImage: attachment is not image')
    }
    
    // Placeholder upload flow - generates unique ID
    await new Promise((r) => setTimeout(r, 100))
    return { id: ulid() }
  }
}
```

### 3. Message Content Assembly

#### Content Building (`web-app/src/lib/completion.ts`)
```typescript
const contentParts = [
  {
    type: ContentType.Text,
    text: {
      value: textWithFiles,
      annotations: [],
    },
  },
]

// Add image attachments to content array
images.forEach((img) => {
  if (img.base64 && img.mimeType) {
    contentParts.push({
      type: ContentType.Image,
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64}`,
        detail: 'auto', // or 'high', 'low'
      },
    })
  }
})
```

#### Message Conversion (`web-app/src/lib/messages.ts`)
```typescript
export const convertToOpenAIContent = (part: any) => {
  // Handle base64 image data
  if (part.data && part.type) {
    const mimeType = part.type === 'image' ? 'image/png' : part.type || 'image/png'
    const dataUrl = `data:${mimeType};base64,${part.data}`

    return {
      type: 'image_url',
      image_url: {
        url: dataUrl,
        detail: 'auto',
      },
    }
  }

  // Handle pre-formatted image URL
  if (part.image_url) {
    return { type: 'image_url', image_url: part.image_url }
  }

  return { type: 'text', text: JSON.stringify(part) }
}
```

## Conversational Web Integration

### 1. Type Definitions (`extensions-web/src/conversational-web/types.ts`)

```typescript
export interface ConversationItemContent {
  type?: string
  image?: {
    detail?: string
    file_id?: string
    url?: string
  }
  image_file?: {
    file_id?: string
    mime_type?: string
  }
  // ... other fields
}
```

### 2. Content Processing (`extensions-web/src/conversational-web/utils.ts`)

#### Content Type Extraction
```typescript
const extractContentByType = (
  content: ConversationItemContent,
  handlers: {
    onText: (value: string) => void
    onReasoning: (value: string) => void
    onImage: (url: string) => void
    onToolCalls: (calls: NonNullable<ConversationItemContent['tool_calls']>) => void
  }
) => {
  switch (content.type) {
    case 'image':
    case 'image_url':
      if (content.image?.url) {
        handlers.onImage(content.image.url)
      }
      break
    // ... other cases
  }
}
```

#### Message Assembly
```typescript
static conversationItemToThreadMessage(
  item: ConversationItem,
  threadId: string
): ThreadMessage {
  const imageUrls: string[] = []
  
  // Extract images from conversation item content
  if (item.content && item.content.length > 0) {
    for (const content of item.content) {
      extractContentByType(content, {
        onImage: (url) => {
          if (url) {
            imageUrls.push(url)
          }
        },
        // ... other handlers
      })
    }
  }
  
  // Build content array with images
  const messageContent: any[] = [/* text content */]
  
  for (const imageUrl of imageUrls) {
    messageContent.push({
      type: 'image_url' as ContentType,
      image_url: {
        url: imageUrl,
      },
    })
  }
  
  return { /* assembled message */ }
}
```

## Vision Model Processing

### 1. Model Capability Check (`web-app/src/lib/models.ts`)
```typescript
export const extractModelCapabilities = (
  modelId: string,
  providerConfig: ModelProvider | undefined
): string[] => {
  const supportsImages = Array.isArray(
    providerConfig?.supportsImages as unknown
  )
    ? (providerConfig.supportsImages as unknown as string[])
    : []

  return [
    ModelCapabilities.COMPLETION,
    supportsToolCalls.includes(modelId) ? ModelCapabilities.TOOLS : undefined,
    supportsImages.includes(modelId) ? ModelCapabilities.VISION : undefined,
  ].filter(Boolean) as string[]
}
```

### 2. Token Calculation (`extensions/llamacpp-extension/src/index.ts`)
```typescript
async getTokensCount(opts: chatCompletionRequest): Promise<number> {
  let imageTokens = 0
  const hasImages = opts.messages.some(
    (msg) =>
      Array.isArray(msg.content) &&
      msg.content.some((content) => content.type === 'image_url')
  )

  if (hasImages) {
    const metadata = await readGgufMetadata(sessionInfo.mmproj_path)
    imageTokens = await this.calculateImageTokens(opts.messages, metadata.metadata)
  }
  
  return textTokens + imageTokens
}

private async calculateImageTokens(
  messages: chatCompletionRequestMessage[],
  metadata: Record<string, string>
): Promise<number> {
  const projectionDim = 
    Math.floor(Number(metadata['clip.vision.projection_dim']) / 10) || 256

  let imageCount = 0
  for (const message of messages) {
    if (Array.isArray(message.content)) {
      imageCount += message.content.filter(
        (content) => content.type === 'image_url'
      ).length
    }
  }

  return projectionDim * imageCount - imageCount // Remove placeholder token
}
```

## UI Components

### 1. Image Attachment Display (`web-app/src/containers/ChatInput.tsx`)
```tsx
{/* Vision image attachment - show only for models with mmproj */}
{hasMmproj && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10"
          onClick={handleImagePickerClick}
        >
          <IconPhoto size={18} className="text-main-view-fg/50" />
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={handleFileChange}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('vision')}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}

{/* Attachment previews */}
{attachments.length > 0 && (
  <div className="flex gap-1 flex-wrap">
    {attachments.map((att, idx) => {
      const isImage = att.type === 'image'
      return (
        <div key={`${att.type}-${idx}-${att.name}`} className="relative">
          {isImage && att.dataUrl ? (
            <img
              className="object-cover w-full h-full"
              src={att.dataUrl}
              alt={att.name}
            />
          ) : (
            <div className="flex flex-col items-center justify-center">
              <IconPaperclip size={18} />
            </div>
          )}
        </div>
      )
    })}
  </div>
)}
```

### 2. Thread Content Rendering (`web-app/src/containers/ThreadContent.tsx`)
```tsx
{/* Render image attachments */}
{item.content?.some(
  (c) => (c.type === 'image_url' && c.image_url?.url) || false
) && (
  <div className="flex justify-end w-full mb-2">
    <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
      {item.content
        ?.filter(
          (c) => (c.type === 'image_url' && c.image_url?.url) || false
        )
        .map((contentPart, index) => {
          if (contentPart.type === 'image_url' && contentPart.image_url?.url) {
            return (
              <div key={index} className="relative">
                <img
                  src={contentPart.image_url.url}
                  alt="Uploaded attachment"
                  className="max-w-[200px] max-h-[200px] object-cover rounded-lg border"
                  onClick={() => openImageModal({
                    url: contentPart.image_url!.url!,
                    alt: "Uploaded attachment"
                  })}
                />
              </div>
            )
          }
        })}
    </div>
  </div>
)}
```

### 3. Image Modal (`web-app/src/containers/dialogs/ImageModal.tsx`)
```tsx
const ImageModal = ({ image, onClose }: ImageModalProps) => {
  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{image?.alt || t('common:image')}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center items-center p-6 pt-2">
          {image && (
            <img
              src={image.url}
              alt={image.alt}
              className="max-w-full max-h-[70vh] object-contain rounded-md"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

## Key Features

### 1. **Multimodal Support**
- **Local models**: Automatic vision detection for models with MMPROJ files
- **Cloud models**: Manual capability configuration via provider settings
- **Smart detection**: Automatically identifies vision-capable models

### 2. **Image Input Methods**
- **File picker**: Native file dialogs on desktop, web input on web
- **Drag & drop**: Direct image dropping onto chat input
- **Clipboard paste**: Paste images directly from clipboard
- **Multiple formats**: Supports JPEG, PNG, and other common image formats

### 3. **Processing Pipeline**
- **Client-side processing**: Images converted to base64 data URLs
- **Size validation**: 10MB file size limit
- **Duplicate detection**: Prevents uploading same image twice
- **Progress tracking**: Shows processing state with visual indicators

### 4. **Integration Points**
- **Thread messages**: Images embedded as `image_url` content type
- **Token calculation**: Accurate token counting for vision models
- **Model compatibility**: Only shows image upload for capable models
- **Cross-platform**: Works on desktop, web, and mobile platforms

## Configuration & Settings

### 1. **Platform Features**
```typescript
// Feature gates for different platforms
const showAttachmentButton = 
  attachmentsEnabled && PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
```

### 2. **Model Configuration**
- Vision capabilities detected via model metadata or explicit configuration
- MMPROJ file requirements for local vision models
- Provider-specific image support settings

### 3. **File Limitations**
- Maximum file size: 10MB per image
- Supported formats: JPEG, PNG (extensible)
- Multiple image upload supported

## Future Considerations

1. **Backend Integration**: Current image ingestion is placeholder-based
2. **Advanced Vision Features**: Support for image analysis, OCR, etc.
3. **Performance Optimization**: Image compression, lazy loading
4. **Extended Format Support**: WebP, AVIF, SVG support
5. **Batch Processing**: Improved handling of multiple image uploads

---

*This documentation reflects the current state of vision/image processing in Jan Extensions-Web as of the codebase analysis. The implementation provides a solid foundation for multimodal AI interactions with room for future enhancements.*