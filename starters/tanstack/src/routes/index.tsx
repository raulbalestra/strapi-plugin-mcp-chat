import { createFileRoute, Link } from '@tanstack/react-router'
import { getProdutos } from '~/lib/strapi'
import { isPreview } from '~/lib/preview'

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>) => ({
    locale: typeof s.locale === 'string' ? s.locale : undefined,
  }),
  loaderDeps: ({ search }) => ({ locale: search.locale }),
  loader: async ({ deps }) => {
    // Em modo preview (cookie presente) buscamos rascunhos; senão, publicados.
    const draft = await isPreview()
    const produtos = await getProdutos(draft, deps.locale)
    return { produtos, draft }
  },
  component: HomePage,
})

const STRAPI_URL = import.meta.env.VITE_STRAPI_URL ?? 'http://localhost:1337'

function HomePage() {
  const { produtos, draft } = Route.useLoaderData()

  return (
    <div>
      {draft ? <p className="preview-badge">Modo preview (rascunhos)</p> : null}
      <h1>Produtos</h1>
      {produtos.length === 0 ? (
        <p className="muted">Nenhum produto cadastrado ainda.</p>
      ) : (
        <ul className="grid">
          {produtos.map((produto) => {
            const capaUrl = produto.capa?.url
              ? `${STRAPI_URL}${produto.capa.url}`
              : null
            return (
              <li key={produto.documentId} className="card">
                <Link to="/produtos/$slug" params={{ slug: produto.slug }}>
                  {capaUrl ? (
                    <img
                      src={capaUrl}
                      alt={produto.capa?.alternativeText ?? produto.titulo}
                    />
                  ) : null}
                  <h2>{produto.titulo}</h2>
                  <p className="preco">R$ {produto.preco.toFixed(2)}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
