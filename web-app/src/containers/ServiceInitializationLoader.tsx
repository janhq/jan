/**
 * Service Initialization Loader
 * 
 * Shows loading screen while services are being initialized
 */

import React from 'react'
import { LoaderIcon } from 'lucide-react'

interface ServiceInitializationLoaderProps {
  error?: Error | null
}

export const ServiceInitializationLoader: React.FC<ServiceInitializationLoaderProps> = ({ error }) => {
  if (error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-app text-app-fg">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-xl font-semibold mb-2">Service Initialization Failed</h1>
          <p className="text-muted-foreground mb-4">
            Failed to initialize application services
          </p>
          <details className="text-left bg-muted p-4 rounded-lg max-w-md">
            <summary className="cursor-pointer font-medium">Error Details</summary>
            <pre className="text-xs mt-2 whitespace-pre-wrap">{error.message}</pre>
          </details>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-app text-app-fg">
      <div className="text-center">
        <div className="mb-4">
          <LoaderIcon className="h-8 w-8 animate-spin mx-auto" />
        </div>
        <h1 className="text-xl font-semibold mb-2">Initializing Services</h1>
        <p className="text-muted-foreground">
          Setting up platform services...
        </p>
      </div>
    </div>
  )
}