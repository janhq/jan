import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getGreeting = (): string => {
  const hour = new Date().getHours()

  if (hour >= 5 && hour < 12) {
    return 'Good Morning!'
  } else if (hour >= 12 && hour < 18) {
    return 'Good Afternoon!'
  } else {
    return 'Good Evening!' // Covers 18:00 to 04:59
  }
}
