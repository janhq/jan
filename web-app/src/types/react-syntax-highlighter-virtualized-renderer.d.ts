/**
 * Declaration file for react-syntax-highlighter-virtualized-renderer
 *
 * This module provides a virtualized renderer for react-syntax-highlighter
 * which improves performance for large code blocks by only rendering
 * the visible portion of the code.
 */
declare module 'react-syntax-highlighter-virtualized-renderer' {
  /**
   * Creates a virtualized renderer for react-syntax-highlighter
   * @returns A renderer function that can be used with react-syntax-highlighter
   */
  export default function virtualizedRenderer(): unknown
}
