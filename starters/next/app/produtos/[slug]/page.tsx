import Link from "next/link";
import { notFound } from "next/navigation";
import { draftMode } from "next/headers";
import { getProdutoBySlug, mediaUrl } from "@/lib/strapi";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ProdutoPage({ params }: PageProps) {
  const { slug } = await params;
  const { isEnabled } = await draftMode();
  const produto = await getProdutoBySlug(slug, isEnabled);

  if (!produto) {
    notFound();
  }

  const capa = mediaUrl(produto.capa?.url);

  return (
    <main className="container">
      <p>
        <Link href="/" className="back-link">
          ← Voltar
        </Link>
      </p>

      {isEnabled && (
        <span className="badge">Modo rascunho (preview) ativo</span>
      )}

      <article className="produto">
        {capa && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={capa}
            alt={produto.capa?.alternativeText ?? produto.titulo}
            className="produto-img"
          />
        )}

        <h1>{produto.titulo}</h1>

        {produto.categoria && (
          <p className="categoria">Categoria: {produto.categoria.nome}</p>
        )}

        <p className="price price-lg">
          {new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(produto.preco)}
        </p>

        {produto.descricao && (
          <div className="descricao">{produto.descricao}</div>
        )}
      </article>
    </main>
  );
}
