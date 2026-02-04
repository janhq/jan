import { create } from 'zustand'
import { ServiceHub } from '@/services'

interface ServiceState {
  serviceHub: ServiceHub | null
  setServiceHub: (serviceHub: ServiceHub) => void
}

<<<<<<< HEAD
const useServiceStore = create<ServiceState>()((set) => ({
=======
export const useServiceStore = create<ServiceState>()((set) => ({
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  serviceHub: null,
  setServiceHub: (serviceHub: ServiceHub) => set({ serviceHub }),
}))

/**
 * Hook to get the ServiceHub instance for React components
 * Throws an error if ServiceHub is not initialized
 */
export const useServiceHub = (): ServiceHub => {
  const serviceHub = useServiceStore((state) => state.serviceHub)
<<<<<<< HEAD
  
  if (!serviceHub) {
    throw new Error('ServiceHub not initialized. Make sure services are initialized before using this hook.')
  }
  
=======

  if (!serviceHub) {
    throw new Error('ServiceHub not initialized. Make sure services are initialized before using this hook.')
  }

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return serviceHub
}

/**
 * Global function to get ServiceHub for non-React contexts (Zustand stores, service files, etc.)
 * Throws an error if ServiceHub is not initialized
 */
export const getServiceHub = (): ServiceHub => {
  const serviceHub = useServiceStore.getState().serviceHub
<<<<<<< HEAD
  
  if (!serviceHub) {
    throw new Error('ServiceHub not initialized. Make sure services are initialized before accessing services.')
  }
  
=======

  if (!serviceHub) {
    throw new Error('ServiceHub not initialized. Make sure services are initialized before accessing services.')
  }

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return serviceHub
}

/**
 * Initialize the ServiceHub in the store
 * This should only be called from the root layout after service initialization
 */
export const initializeServiceHubStore = (serviceHub: ServiceHub) => {
  useServiceStore.getState().setServiceHub(serviceHub)
}

/**
 * Check if ServiceHub is initialized
 */
export const isServiceHubInitialized = (): boolean => {
  return useServiceStore.getState().serviceHub !== null
}
