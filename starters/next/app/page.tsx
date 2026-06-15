import Link from "next/link";
import { draftMode } from "next/headers";
import { getProdutos, mediaUrl } from "@/lib/strapi";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const { isEnabled } = await draftMode();
  const { locale } = await searchParams;
  const produtos = await getProdutos(isEnabled, locale);

  return (
    <main className="container">
      <header className="page-header">
        <h1>Loja Exemplo</h1>
        {isEnabled && (
          <span className="badge">Modo rascunho (preview) ativo</span>
        )}
      </header>

      {produtos.length === 0 ? (
        <p className="empty">
          Nenhum produto encontrado. Cadastre produtos no admin do Strapi.
        </p>
      ) : (
        <ul className="grid">
          {produtos.map((produto) => {
            const capa = mediaUrl(produto.capa?.url);
            return (
              <li key={produto.documentId} className="card">
                <Link href={`/produtos/${produto.slug}`}>
                  {capa && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={capa}
                      alt={produto.capa?.alternativeText ?? produto.titulo}
                      className="card-img"
                    />
                  )}
                  <div className="card-body">
                    <h2>{produto.titulo}</h2>
                    <p className="price">
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(produto.preco)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
