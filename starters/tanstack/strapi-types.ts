// AVISO: este arquivo é regenerado automaticamente pelo plugin strapi-mcp-chat
// a partir das content-types definidas em strapi.manifest.json.
// A versão abaixo é apenas inicial, para o starter compilar de forma standalone.
// Edições manuais serão sobrescritas no próximo upload/sincronização.

export interface StrapiMedia {
  id: number
  documentId: string
  name: string
  alternativeText: string | null
  caption: string | null
  width: number | null
  height: number | null
  url: string
  formats: Record<string, { url: string; width: number; height: number }> | null
  mime: string
}

export interface Categoria {
  id: number
  documentId: string
  nome: string
  slug: string
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export interface Produto {
  id: number
  documentId: string
  titulo: string
  slug: string
  descricao: string | null
  preco: number
  capa: StrapiMedia | null
  categoria: Categoria | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

// Envelope padrão das respostas da REST API do Strapi 5 (formato "flat").
export interface StrapiResponse<T> {
  data: T
  meta: {
    pagination?: {
      page: number
      pageSize: number
      pageCount: number
      total: number
    }
  }
}
