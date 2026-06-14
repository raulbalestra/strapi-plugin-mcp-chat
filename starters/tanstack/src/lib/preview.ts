import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

// Nome do cookie setado pela rota /api/preview.
export const PREVIEW_COOKIE = 'strapi_preview'

// Server function: lê o cookie de preview a partir da requisição.
// Retorna true quando estamos em modo rascunho (preview vindo do admin do Strapi).
export const isPreview = createServerFn({ method: 'GET' }).handler(() => {
  return getCookie(PREVIEW_COOKIE) === '1'
})
