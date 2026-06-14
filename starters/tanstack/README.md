# loja-exemplo — starter TanStack Start

Frontend de referência (TanStack Start, SSR + Vite + TypeScript, file-based
routing) que segue o contrato do plugin **strapi-mcp-chat**. É uma loja simples
com produtos e categorias, pronta para ser conectada a um Strapi 5 e para
funcionar com o preview ao vivo do admin.

## Como rodar

```bash
npm install
npm run dev
```

O dev server sobe em `http://localhost:5173`.

Antes, copie `.env.example` para `.env` e ajuste as variáveis (se você usa o
plugin, ele cuida disso automaticamente — veja abaixo).

## Variáveis de ambiente

| Variável            | Escopo         | Descrição                                                            |
| ------------------- | -------------- | ------------------------------------------------------------------- |
| `VITE_STRAPI_URL`   | público        | URL do Strapi, lida no cliente via `import.meta.env`.               |
| `STRAPI_API_TOKEN`  | servidor       | Token de API (opcional). Só acessível em loaders/server functions. |
| `PREVIEW_SECRET`    | servidor       | Segredo compartilhado para validar `/api/preview`.                  |

## Como o contrato / upload funciona

1. Você customiza este starter (rotas, estilos, componentes).
2. Zipa a pasta e faz upload no admin do Strapi (plugin strapi-mcp-chat).
3. O plugin lê o `strapi.manifest.json`, cria as content-types no Strapi,
   semeia os dados iniciais (seed) e injeta:
   - as variáveis de ambiente em `.env`;
   - os tipos TypeScript em `strapi-types.ts`.

Por isso **`strapi-types.ts` e `.env` são geridos pelo plugin** — edições
manuais nesses arquivos são sobrescritas na próxima sincronização. O mesmo vale
para `src/routeTree.gen.ts`, que é gerado pelo TanStack Router.

## Content-types (do manifest)

- **Produto**: `titulo`, `slug` (uid), `descricao` (richtext), `preco`
  (decimal), `capa` (media), `categoria` (relação manyToOne). Draft & Publish
  habilitado.
- **Categoria**: `nome`, `slug` (uid).

## Preview ao vivo

O admin do Strapi gera URLs de preview no formato:

```
${URL_DO_CLIENTE}/api/preview?secret=<PREVIEW_SECRET>&status=draft&path=/produtos/<slug>
```

- A rota de servidor `src/routes/api/preview.ts` valida o `secret` contra
  `process.env.PREVIEW_SECRET`. Se bater, seta o cookie `strapi_preview=1`
  (httpOnly) e redireciona (302) para `path`; se não, responde 401.
- Os loaders (`/` e `/produtos/$slug`) checam esse cookie: com ele presente
  buscam rascunhos (`status=draft`), senão conteúdo publicado
  (`status=published`).
- `src/components/PreviewBridge.tsx` roda só dentro do iframe do admin: avisa a
  janela pai da localização atual via `postMessage` e preserva o scroll por rota.

## Estrutura

```
strapi.manifest.json      Contrato lido pelo plugin
strapi-types.ts           Tipos (gerados pelo plugin)
src/
  router.tsx              Criação do router
  client.tsx              Entrada de hidratação (cliente)
  server.tsx              Handler de SSR
  styles.css              Estilo base
  lib/
    strapi.ts             Helpers de fetch ao Strapi
    preview.ts            Leitura do cookie de preview (server function)
  components/
    PreviewBridge.tsx     Ponte de preview (iframe)
  routes/
    __root.tsx            Shell HTML
    index.tsx             Home (lista de produtos)
    produtos/$slug.tsx    Detalhe do produto
    api/preview.ts        Rota de servidor /api/preview
```

## Notas sobre o Strapi 5

As respostas da REST API do Strapi 5 são "flat": os campos ficam direto em cada
item (`{ data: [{ documentId, titulo, slug, ... }] }`), sem o antigo nível
`attributes`. Os helpers em `src/lib/strapi.ts` já assumem esse formato.
