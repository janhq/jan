/**
 * Custom hook for RAG file upload functionality
 */

import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { UploadStatus } from '@/types/rag'
import { createFileMetadata, createFileMetadataFromPath, isValidFileType } from '@/lib/rag-utils'
import { getErrorMessage } from '@/lib/format-utils'
import { useRAGDocumentOperations } from './useRAGDocumentOperations'

interface UseRAGFileUploadProps {
  onUploadComplete?: () => void
}

export const useRAGFileUpload = ({ onUploadComplete }: UseRAGFileUploadProps = {}) => {
  const { addDocument, loadDocuments } = useRAGDocumentOperations()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [currentFileName, setCurrentFileName] = useState<string>('')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Reset upload state
   */
  const resetUploadState = useCallback(() => {
    setUploading(false)
    setUploadProgress(0)
    setUploadStatus('idle')
    setCurrentFileName('')
  }, [])

  /**
   * Process file for RAG with progress tracking
   */
  const processFileForRAG = useCallback(async (
    filePath: string,
    fileMetadata: Record<string, unknown>
  ) => {
    try {
      setUploadProgress(80) // Starting RAG processing
      
      // Add to RAG system
      await addDocument(filePath, fileMetadata)

      setUploadProgress(100) // Complete
      setUploadStatus('success')
      await loadDocuments()

      // Auto-close dialog after success
      setTimeout(() => {
        onUploadComplete?.()
      }, 1500)
    } catch (error) {
      console.error('Failed to process file for RAG:', error)
      setUploadStatus('error')
      toast.error(`Failed to process file: ${getErrorMessage(error)}`)
    } finally {
      setTimeout(() => {
        resetUploadState()
      }, 2000)
    }
  }, [addDocument, loadDocuments, onUploadComplete, resetUploadState])

  /**
   * Handle file upload from input
   */
  const handleFiles = useCallback(async (files: FileList) => {
    if (!files || files.length === 0) {
      return
    }

    const file = files[0]

    // Validate file type
    if (!isValidFileType(file.name)) {
      toast.error('Unsupported file type. Please upload PDF, TXT, MD, DOCX, HTML, CSV, or JSON files.')
      return
    }

    setUploading(true)
    setUploadStatus('uploading')
    setCurrentFileName(file.name)
    setUploadProgress(0)

    try {
      // Convert file to base64
      const reader = new FileReader()
      
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 50 // First 50% for file reading
          setUploadProgress(progress)
        }
      }

      reader.onload = async () => {
        try {
          setUploadProgress(50) // File reading complete
          const base64Content = reader.result as string
          const base64Data = base64Content.split(',')[1] // Remove data:mime;base64, prefix

          setUploadProgress(60) // Starting file save
          
          // Save file using Tauri
          const tempFilePath = await window.core?.api?.saveFile({
            base64Content: base64Data,
            fileName: file.name,
          })

          // Process the saved file for RAG
          await processFileForRAG(tempFilePath, createFileMetadata(file))
        } catch (error) {
          console.error('Failed to process file:', error)
          setUploadStatus('error')
          toast.error(`Failed to process file: ${getErrorMessage(error)}`)
          setTimeout(resetUploadState, 2000)
        }
      }

      reader.onerror = () => {
        setUploadStatus('error')
        toast.error('Failed to read file')
        resetUploadState()
      }

      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Failed to read file:', error)
      setUploadStatus('error')
      toast.error('Failed to read file')
      resetUploadState()
    }
  }, [processFileForRAG, resetUploadState])

  /**
   * Handle file upload from input change
   */
  const handleFileUpload = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files
    if (files && files.length > 0) {
      await handleFiles(files)
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [handleFiles])

  /**
   * Handle file drop from Tauri
   */
  const handleTauriFileDrop = useCallback(async (filePaths: string[]) => {
    if (!filePaths || filePaths.length === 0) {
      return
    }

    // Check if already uploading to prevent overlap
    if (uploading) {
      return
    }

    const filePath = filePaths[0] // Handle first file for now
    const fileName = filePath.split('/').pop() ?? 'Unknown file'
    
    // Validate file type
    if (!isValidFileType(fileName)) {
      toast.error('Unsupported file type. Please upload PDF, TXT, MD, DOCX, HTML, CSV, or JSON files.')
      return
    }

    setUploading(true)
    setUploadStatus('uploading')
    setCurrentFileName(fileName)
    setUploadProgress(0)

    setUploadProgress(60) // Starting file processing
    
    await processFileForRAG(filePath, createFileMetadataFromPath(filePath))
  }, [processFileForRAG, uploading])

  /**
   * Trigger file picker
   */
  const triggerFileSelect = useCallback(() => {
    if (!uploading) {
      fileInputRef.current?.click()
    }
  }, [uploading])

  return {
    // State
    uploading,
    uploadProgress,
    uploadStatus,
    currentFileName,
    dragActive,
    fileInputRef,
    
    // Actions
    handleFiles,
    handleFileUpload,
    handleTauriFileDrop,
    triggerFileSelect,
    resetUploadState,
    setDragActive
  }
}