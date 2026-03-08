export {}

declare global {
  interface RequestInit {
    /**
     * Tauri HTTP plugin option for connection timeout in milliseconds.
     */
    connectTimeout?: number
  }
}


