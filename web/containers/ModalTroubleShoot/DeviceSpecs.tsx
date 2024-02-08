import React from 'react'

const DeviceSpecs = () => {
  const userAgent = window.navigator.userAgent

  return (
    <div>
      <p className="leading-relaxed">{userAgent}</p>
    </div>
  )
}

export default DeviceSpecs
