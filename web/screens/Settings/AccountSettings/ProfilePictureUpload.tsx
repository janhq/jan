import React, { useCallback, useState } from 'react'
import Image from 'next/image'
import { toast } from 'react-hot-toast'

interface ProfilePictureUploadProps {
  currentImage: string
  onImageUpdate: (imagePath: string) => Promise<void>
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/jpg']

const ProfilePictureUpload: React.FC<ProfilePictureUploadProps> = ({
  currentImage,
  onImageUpdate
}) => {
  const [isUploading, setIsUploading] = useState(false)

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Please upload a valid image file (PNG or JPG)')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image size should be less than 2MB')
      return
    }

    setIsUploading(true)
    try {
      // Convert file to buffer
      const buffer = await file.arrayBuffer()
      const fileName = `profile-${Date.now()}.${file.type.split('/')[1]}`

      // Get Jan data folder path
      const dataFolder = await window.core?.api?.getJanDataFolderPath()
      if (!dataFolder) {
        throw new Error('Could not get Jan data folder')
      }

      // Create images directory path
      const imagesPath = await window.core?.api?.joinPath([dataFolder, 'images'])
      if (!imagesPath) {
        throw new Error('Could not create images path')
      }

      // Create directory if it doesn't exist
      try {
        await window.core?.api?.mkdir(imagesPath)
      } catch (error) {
        // Directory might already exist, continue
      }

      // Create full file path
      const filePath = await window.core?.api?.joinPath([imagesPath, fileName])
      if (!filePath) {
        throw new Error('Could not create file path')
      }

      // Write file
      await window.core?.api?.writeFile(filePath, Buffer.from(buffer))

      // Update preferences
      await onImageUpdate(filePath)
      toast.success('Profile picture updated successfully')
    } catch (error) {
      console.error('Failed to upload image:', error)
      toast.error('Failed to update profile picture')
    } finally {
      setIsUploading(false)
    }
  }, [onImageUpdate])

  const handleRemoveImage = useCallback(async () => {
    try {
      await onImageUpdate('')
      toast.success('Profile picture removed')
    } catch (error) {
      console.error('Failed to remove image:', error)
      toast.error('Failed to remove profile picture')
    }
  }, [onImageUpdate])

  const imageUrl = currentImage || '/default-avatar.svg'

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-gray-200">
        {imageUrl.startsWith('/') ? (
          <Image
            src={imageUrl}
            alt="Profile"
            width={128}
            height={128}
            className="object-cover"
          />
        ) : (
          <img
            src={`file://${imageUrl}`}
            alt="Profile"
            className="w-full h-full object-cover"
          />
        )}
      </div>

      <div className="flex space-x-4">
        <label className="cursor-pointer px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
          <input
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/jpg"
            onChange={handleImageUpload}
            disabled={isUploading}
          />
          {isUploading ? 'Uploading...' : 'Upload Picture'}
        </label>

        {currentImage && (
          <button
            onClick={handleRemoveImage}
            className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

export default ProfilePictureUpload
