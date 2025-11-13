/**
 * Media API Quick Reference Examples
 * Extensions-web with Presigned Upload Integration
 */

import { webUploadsService, mediaService } from '@jan/extensions-web'

// ============================================================================
// RECOMMENDED: Smart Automatic Upload
// ============================================================================

/**
 * Example 1: Upload with automatic strategy selection
 * Automatically uses presigned upload for large files
 */
async function smartUpload(imageDataUrl: string, filename: string, threadId: string) {
  const result = await webUploadsService.ingestImage(
    threadId,
    {
      type: 'image',
      name: filename,
      dataUrl: imageDataUrl,
      mimeType: 'image/jpeg',
      size: 2048576 // 2MB - will trigger presigned upload
    }
  )
  
  console.log('Uploaded:', result.id)
  return result
}

// ============================================================================
// Browser File Upload (File Input / Drag & Drop)
// ============================================================================

/**
 * Example 2: Upload file from browser input
 * Optimized presigned upload for File objects
 */
async function uploadFromFileInput(fileInputId: string, threadId: string) {
  const input = document.getElementById(fileInputId) as HTMLInputElement
  const file = input.files?.[0]
  
  if (!file) {
    throw new Error('No file selected')
  }
  
  // Direct presigned upload - best for File objects
  const result = await webUploadsService.ingestImageFileWithPresignedUpload(
    threadId,
    file
  )
  
  console.log('Uploaded file:', result.id, result.url)
  return result
}

/**
 * Example 3: Drag and drop file upload
 */
function setupDragAndDrop(dropZoneId: string, threadId: string) {
  const dropZone = document.getElementById(dropZoneId)
  
  dropZone?.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    
    if (file && file.type.startsWith('image/')) {
      const result = await webUploadsService.ingestImageFileWithPresignedUpload(
        threadId,
        file
      )
      console.log('Dropped file uploaded:', result.id)
    }
  })
  
  dropZone?.addEventListener('dragover', (e) => e.preventDefault())
}

// ============================================================================
// Explicit Presigned Upload Flow
// ============================================================================

/**
 * Example 4: Manual presigned upload with full control
 * Use when you need granular control over each step
 */
async function manualPresignedUpload(file: File, userId: string) {
  try {
    // Step 1: Prepare upload
    console.log('Step 1: Preparing presigned upload...')
    const prep = await mediaService.prepareUpload(file.type, userId)
    console.log('Got jan_id:', prep.id)
    console.log('Upload URL expires in:', prep.expires_in, 'seconds')
    
    // Step 2: Upload to S3
    console.log('Step 2: Uploading to S3...')
    const uploadResponse = await fetch(prep.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': prep.mime_type,
      },
      body: file
    })
    
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status}`)
    }
    console.log('Upload successful!')
    
    // Step 3: Get download URL
    console.log('Step 3: Getting download URL...')
    const download = await mediaService.getPresignedUrl(prep.id)
    console.log('Download URL:', download.url)
    console.log('URL expires in:', download.expires_in, 'seconds')
    
    return {
      janId: prep.id,
      downloadUrl: download.url,
      expiresIn: download.expires_in
    }
  } catch (error) {
    console.error('Upload failed:', error)
    throw error
  }
}

// ============================================================================
// Get Download URL for Existing Media
// ============================================================================

/**
 * Example 5: Get presigned download URL for existing media
 */
async function getDownloadUrl(janId: string) {
  const presigned = await mediaService.getPresignedUrl(janId)
  
  console.log('Download URL:', presigned.url)
  console.log('Expires in:', presigned.expires_in, 'seconds')
  
  return presigned.url
}

/**
 * Example 6: Display image from jan_id
 */
async function displayImage(janId: string, imgElementId: string) {
  const presigned = await mediaService.getPresignedUrl(janId)
  const imgElement = document.getElementById(imgElementId) as HTMLImageElement
  
  if (imgElement) {
    imgElement.src = presigned.url
  }
}

// ============================================================================
// Direct Upload (Small Files)
// ============================================================================

/**
 * Example 7: Direct upload via media server
 * Good for small files or when you already have data URLs
 */
async function directUpload(dataUrl: string, filename: string, userId: string) {
  const result = await mediaService.uploadImage(dataUrl, filename, userId)
  
  console.log('Uploaded:', result.id)
  console.log('Deduped:', result.deduped)
  console.log('Size:', result.bytes, 'bytes')
  
  return result
}

// ============================================================================
// Complete Upload + Display Flow
// ============================================================================

/**
 * Example 8: Complete workflow - upload and display
 */
async function uploadAndDisplay(file: File, threadId: string, imgElementId: string) {
  try {
    // Upload using smart routing
    console.log('Uploading...')
    const uploadResult = await webUploadsService.ingestImageFileWithPresignedUpload(
      threadId,
      file
    )
    
    console.log('Uploaded successfully!')
    console.log('jan_id:', uploadResult.id)
    console.log('Size:', uploadResult.size, 'bytes')
    
    // Display the image
    const imgElement = document.getElementById(imgElementId) as HTMLImageElement
    if (imgElement && uploadResult.url) {
      imgElement.src = uploadResult.url
      console.log('Image displayed!')
    }
    
    return uploadResult
  } catch (error) {
    console.error('Failed to upload and display:', error)
    throw error
  }
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Example 9: Proper error handling
 */
async function uploadWithErrorHandling(file: File, threadId: string) {
  try {
    const result = await webUploadsService.ingestImageFileWithPresignedUpload(
      threadId,
      file
    )
    return result
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('S3 upload failed')) {
        console.error('S3 upload error - check network and credentials')
      } else if (error.message.includes('not found')) {
        console.error('Media not found')
      } else if (error.message.includes('Authentication failed')) {
        console.error('Auth token expired or invalid')
      } else {
        console.error('Unknown error:', error.message)
      }
    }
    throw error
  }
}

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Example 10: Check service configuration
 */
function checkConfiguration() {
  const config = webUploadsService.getConfiguration()
  
  console.log('Media Server Configuration:')
  console.log('- Enabled:', config.mediaServerEnabled)
  console.log('- Presigned Upload:', config.usePresignedUpload)
  console.log('- Base URL:', config.baseUrl)
  console.log('- Service Type:', config.serviceType)
  console.log('- Version:', config.version)
  
  return config
}

// ============================================================================
// Usage Examples
// ============================================================================

// In your app initialization
checkConfiguration()

// Handle file input
document.getElementById('fileInput')?.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    await uploadAndDisplay(file, 'thread123', 'previewImage')
  }
})

// Handle existing media
async function showExistingMedia(janId: string) {
  await displayImage(janId, 'mediaImage')
}

export {
  smartUpload,
  uploadFromFileInput,
  setupDragAndDrop,
  manualPresignedUpload,
  getDownloadUrl,
  displayImage,
  directUpload,
  uploadAndDisplay,
  uploadWithErrorHandling,
  checkConfiguration
}
