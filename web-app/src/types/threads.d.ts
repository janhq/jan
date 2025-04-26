/**
 * The content type of the message.
 */
enum ContentType {
  Text = 'text',
  Image = 'image_url',
}

/**
 * The `ContentValue` type defines the shape of a content value object
 * @data_transfer_object
 */
type ContentValue = {
  value: string
  annotations: string[]
}

/**
 * The `ImageContentValue` type defines the shape of a content value object of image type
 * @data_transfer_object
 */
type ImageContentValue = {
  detail?: string
  url?: string
}

type ThreadContent = {
  type: ContentType
  text?: ContentValue
  image_url?: ImageContentValue
}

type Thread = {
  id: string
  title: string
  isFavorite?: boolean
  content: ThreadContent[]
}
