import type {
  Produto,
  StrapiCollectionResponse,
} from "@/strapi-types";

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? "http://localhost:1337";
const API_TOKEN = process.env.STRAPI_API_TOKEN;

interface FetchOptions {
  /** Quando true, busca conteúdo em rascunho (Draft Mode). */
  draft?: boolean;
}

/**
 * Helper central de fetch para a API REST do Strapi.
 *
 * - Monta a URL a partir de NEXT_PUBLIC_STRAPI_URL.
 * - Adiciona `Authorization: Bearer <token>` se STRAPI_API_TOKEN existir.
 * - Acrescenta `status=draft` ou `status=published` conforme o Draft Mode.
 */
export async function strapiFetch<T>(
  path: string,
  { draft = false }: FetchOptions = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), `${STRAPI_URL}/`);
  url.searchParams.set("status", draft ? "draft" : "published");

  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const res = await fetch(url.toString(), {
    headers,
    // Em Draft Mode não cacheamos; em produção (publicado) deixamos o Next decidir.
    cache: draft ? "no-store" : "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Strapi respondeu ${res.status} ${res.statusText} para ${url.pathname}`,
    );
  }

  return (await res.json()) as T;
}

/** Lista todos os produtos (com relações e mídia populadas). */
export async function getProdutos(draft = false): Promise<Produto[]> {
  const json = await strapiFetch<StrapiCollectionResponse<Produto>>(
    "/api/produtos?populate=*",
    { draft },
  );
  return json.data ?? [];
}

/** Busca um produto pelo slug. Retorna null se não existir. */
export async function getProdutoBySlug(
  slug: string,
  draft = false,
): Promise<Produto | null> {
  const query = `/api/produtos?filters[slug][$eq]=${encodeURIComponent(
    slug,
  )}&populate=*`;
  const json = await strapiFetch<StrapiCollectionResponse<Produto>>(query, {
    draft,
  });
  return json.data?.[0] ?? null;
}

/** Resolve a URL absoluta de uma mídia do Strapi (que pode vir relativa). */
export function mediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${STRAPI_URL}${url}`;
}
