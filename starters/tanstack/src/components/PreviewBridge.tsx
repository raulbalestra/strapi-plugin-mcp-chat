import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'

// Componente client que só atua quando a página roda dentro de um iframe
// (o painel de preview do admin do Strapi). Ele:
//  (a) avisa a janela pai da localização atual via postMessage (mount + navegação);
//  (b) salva e restaura window.scrollY por pathname em sessionStorage.
export function PreviewBridge() {
  const location = useRouterState({ select: (s) => s.location })
  const pathname = location.pathname

  useEffect(() => {
    // Fora de um iframe não há nada a fazer.
    if (typeof window === 'undefined' || window.parent === window) return

    const scrollKey = `preview:scroll:${pathname}`

    // Restaura a posição de scroll salva para este pathname.
    const saved = sessionStorage.getItem(scrollKey)
    if (saved) {
      window.scrollTo(0, Number(saved))
    }

    // Notifica a janela pai da localização atual.
    window.parent.postMessage(
      { type: 'preview:location', url: window.location.href },
      '*',
    )

    // Salva a posição de scroll continuamente.
    const onScroll = () => {
      sessionStorage.setItem(scrollKey, String(window.scrollY))
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      // Salva uma última vez antes de trocar de rota.
      sessionStorage.setItem(scrollKey, String(window.scrollY))
    }
  }, [pathname])

  return null
}
