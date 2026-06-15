import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRoute,
  Link,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PreviewBridge } from '~/components/PreviewBridge'
import { LanguageSwitcher } from '~/components/LanguageSwitcher'
import appCss from '~/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Loja Exemplo' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Ponte de preview: só atua quando a página roda dentro de um iframe. */}
        <PreviewBridge />
        <header className="site-header">
          <Link to="/" className="logo">
            Loja Exemplo
          </Link>
          <LanguageSwitcher />
        </header>
        <main className="container">{children}</main>
        <Scripts />
      </body>
    </html>
  )
}
