import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// O arquivo routeTree.gen.ts é gerado automaticamente pelo plugin do TanStack
// Start ao rodar `vite dev` / `vite build` (file-based routing).
export function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
