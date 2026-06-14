import { createServerFileRoute, setCookie } from '@tanstack/react-start/server'
import { PREVIEW_COOKIE } from '~/lib/preview'

// Rota de servidor do TanStack Start (v1): createServerFileRoute em
// src/routes/api/preview.ts expõe GET /api/preview.
//
// O admin do Strapi gera URLs no formato:
//   ${URL_DO_CLIENTE}/api/preview?secret=<PREVIEW_SECRET>&status=draft&path=/produtos/<slug>
//
// Esta rota valida o secret, seta o cookie de preview e redireciona para `path`.
export const ServerRoute = createServerFileRoute('/api/preview').methods({
  GET: ({ request }) => {
    const url = new URL(request.url)
    const secret = url.searchParams.get('secret')
    const path = url.searchParams.get('path') ?? '/'

    // PREVIEW_SECRET é server-only (process.env).
    if (!secret || secret !== process.env.PREVIEW_SECRET) {
      return new Response('Secret de preview inválido', { status: 401 })
    }

    // Cookie httpOnly que sinaliza modo preview para os loaders.
    setCookie(PREVIEW_COOKIE, '1', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    })

    // Só permite caminhos relativos internos (evita open redirect).
    const safePath = path.startsWith('/') ? path : '/'
    return new Response(null, {
      status: 302,
      headers: { Location: safePath },
    })
  },
})
