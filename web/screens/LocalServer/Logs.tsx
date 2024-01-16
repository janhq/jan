/* eslint-disable @typescript-eslint/naming-convention */
import { useEffect, useState } from 'react'

import React from 'react'

import { useServerLog } from '@/hooks/useServerLog'

const Logs = () => {
  const { getServerLog } = useServerLog()
  const [logs, setLogs] = useState([])

  useEffect(() => {
    getServerLog().then((log) => {
      setLogs(log.split(/\r?\n|\r|\n/g))
    })

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs])

  return (
    <div className="p-4">
      <code className="text-xs">
        {logs.map((log, i) => {
          return (
            <p key={i} className="my-2 leading-relaxed">
              {log}
            </p>
          )
        })}
      </code>
    </div>
  )
}

export default Logs
