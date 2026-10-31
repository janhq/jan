import { createContext, useContext } from 'react'

// React context survives body portals; CSS custom properties on modal DOM do not.
// Keep the two classes literal so Tailwind includes both in the generated CSS.
export const ModalLayerContext = createContext(false)

export function useFloatingLayer() {
  return useContext(ModalLayerContext)
    ? 'z-(--layer-modal-floating)'
    : 'z-(--layer-floating)'
}
