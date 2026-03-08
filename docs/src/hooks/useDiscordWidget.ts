import React, { useEffect, useState } from 'react'

import axios from 'axios'
import { isAxiosError } from 'axios'

export const useDiscordWidget = () => {
  const [data, setData] = useState<{ presence_count: number }>({
    presence_count: 0,
  })

  useEffect(() => {
    const updateData = async () => {
      try {
        const { data } = await axios.get<{ presence_count: number }>(
          'https://discord.com/api/guilds/1107178041848909847/widget.json'
        )
        setData({
          ...data,
        })
      } catch (error) {
        if (isAxiosError(error)) {
          console.error('Failed to get discord widget:', error)
        }
      }
    }
    updateData()
  }, [])

  return { data }
}
