/**
 * ATENÇÃO: este arquivo é REGENERADO automaticamente pelo plugin
 * strapi-mcp-chat ao processar o `strapi.manifest.json`.
 *
 * Não edite manualmente — quaisquer alterações serão sobrescritas no
 * próximo upload/sincronização. Esta versão inicial existe apenas para
 * que o projeto compile de forma standalone.
 */

/** Mídia (imagem/arquivo) no formato flat do Strapi 5. */
export interface StrapiMedia {
  id: number;
  documentId: string;
  url: string;
  alternativeText?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  mime?: string;
  name?: string;
}

/** Content-type: Categoria */
export interface Categoria {
  id: number;
  documentId: string;
  nome: string;
  slug: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

/** Content-type: Produto */
export interface Produto {
  id: number;
  documentId: string;
  titulo: string;
  slug: string;
  descricao?: string | null;
  preco: number;
  capa?: StrapiMedia | null;
  categoria?: Categoria | null;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

/** Envelope padrão de resposta do Strapi 5 (coleções). */
export interface StrapiCollectionResponse<T> {
  data: T[];
  meta?: {
    pagination?: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

/** Envelope padrão de resposta do Strapi 5 (item único). */
export interface StrapiSingleResponse<T> {
  data: T | null;
  meta?: Record<string, unknown>;
}
