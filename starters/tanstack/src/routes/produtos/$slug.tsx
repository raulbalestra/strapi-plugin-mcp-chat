import { createFileRoute, Link } from '@tanstack/react-router'
import { getProdutoBySlug } from '~/lib/strapi'
import { isPreview } from '~/lib/preview'

export const Route = createFileRoute('/produtos/$slug')({
  validateSearch: (s: Record<string, unknown>) => ({
    locale: typeof s.locale === 'string' ? s.locale : undefined,
  }),
  loaderDeps: ({ search }) => ({ locale: search.locale }),
  loader: async ({ params, deps }) => {
    const draft = await isPreview()
    const produto = await getProdutoBySlug(params.slug, draft, deps.locale)
    return { produto, draft }
  },
  component: ProdutoPage,
})

const STRAPI_URL = import.meta.env.VITE_STRAPI_URL ?? 'http://localhost:1337'

function ProdutoPage() {
  const { produto, draft } = Route.useLoaderData()

  if (!produto) {
    return (
      <div>
        <p className="muted">Produto não encontrado.</p>
        <Link to="/">Voltar para a lista</Link>
      </div>
    )
  }

  const capaUrl = produto.capa?.url ? `${STRAPI_URL}${produto.capa.url}` : null

  return (
    <article className="produto-detalhe">
      {draft ? <p className="preview-badge">Modo preview (rascunhos)</p> : null}
      <Link to="/" className="voltar">
        ← Voltar
      </Link>
      {capaUrl ? (
        <img src={capaUrl} alt={produto.capa?.alternativeText ?? produto.titulo} />
      ) : null}
      <h1>{produto.titulo}</h1>
      {produto.categoria ? (
        <p className="muted">Categoria: {produto.categoria.nome}</p>
      ) : null}
      <p className="preco">R$ {produto.preco.toFixed(2)}</p>
      {produto.descricao ? (
        <div
          className="descricao"
          dangerouslySetInnerHTML={{ __html: produto.descricao }}
        />
      ) : null}
    </article>
  )
}
