/// <reference types="vite/client" />
import type { MdoApi } from '../shared/types'

declare global {
  interface Window {
    mdo: MdoApi
  }
}
