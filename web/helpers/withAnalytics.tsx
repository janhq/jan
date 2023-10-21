'use client'
import React, { useEffect } from 'react'

export function withAnalytics<P extends Record<string, any>>(
  Component: React.ComponentType<P>
): React.FC<P> {
  const WrappedComponent: React.FC<P> = (props) => {
    useEffect(() => {}, [])

    return <Component {...props} />
  }
  return WrappedComponent
}
