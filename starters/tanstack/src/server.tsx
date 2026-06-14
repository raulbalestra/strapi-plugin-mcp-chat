import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { createRouter } from './router'

// Handler de SSR do TanStack Start.
export default createStartHandler({
  createRouter,
})(defaultStreamHandler)
