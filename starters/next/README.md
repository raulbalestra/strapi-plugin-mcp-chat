# Loja Exemplo — Starter Next.js

Starter de referência (Next.js 15, App Router, TypeScript) que segue o
**contrato** do plugin `strapi-mcp-chat`. É um frontend pronto para você
customizar, zipar e enviar pelo admin do Strapi.

## Como funciona o fluxo

1. Você customiza este starter (layout, estilos, novos campos etc.).
2. Você compacta a pasta em um `.zip` e faz upload no admin do Strapi.
3. O plugin lê o arquivo [`strapi.manifest.json`](./strapi.manifest.json) e:
   - cria as **content-types** descritas (`produto`, `categoria`);
   - **semeia** os dados iniciais declarados em `seed`;
   - escreve as **variáveis de ambiente** em `.env.local`;
   - **regenera** o arquivo [`strapi-types.ts`](./strapi-types.ts) com os
     tipos das content-types.

Ou seja: o contrato já vem pronto neste starter — basta editá-lo conforme
sua necessidade.

## Rodando localmente

```bash
npm install
npm run dev
```

O Next sobe na porta **3000** (`http://localhost:3000`).

Copie `.env.example` para `.env.local` (ou deixe o plugin gerar) e ajuste
os valores:

| Variável                  | Escopo    | Descrição                                              |
| ------------------------- | --------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_STRAPI_URL`  | público   | URL do Strapi, ex. `http://localhost:1337`             |
| `STRAPI_API_TOKEN`        | servidor  | Token de API (opcional, para conteúdo protegido)       |
| `PREVIEW_SECRET`          | servidor  | Segredo para ativar o Draft Mode / Preview             |

## Estrutura de conteúdo

- **Home (`/`)** — lista produtos via
  `GET ${NEXT_PUBLIC_STRAPI_URL}/api/produtos?populate=*`.
- **Produto (`/produtos/[slug]`)** — busca por
  `filters[slug][$eq]=<slug>`; retorna 404 se não existir.

As respostas seguem o formato **flat** do Strapi 5
(`{ data: [{ documentId, titulo, slug, ... }] }`, sem `attributes`).

## Preview / Draft Mode

O admin do Strapi gera URLs de preview no formato:

```
${NEXT_PUBLIC_STRAPI_URL}/api/preview?secret=<PREVIEW_SECRET>&status=draft&path=/produtos/<slug>
```

A rota [`app/api/preview/route.ts`](./app/api/preview/route.ts):

1. valida o `secret` contra `process.env.PREVIEW_SECRET` (401 se inválido);
2. ativa o Draft Mode (`(await draftMode()).enable()`);
3. redireciona para o `path` solicitado.

Com o Draft Mode ligado, os server components buscam conteúdo em rascunho
(`status=draft`); caso contrário, buscam publicado (`status=published`).

O componente [`PreviewBridge`](./app/_components/PreviewBridge.tsx) roda
apenas dentro do iframe de preview do Strapi: ele informa a URL atual ao
admin via `postMessage` e preserva a posição de scroll por página.

## Arquivos geridos pelo plugin

Estes arquivos são sobrescritos no upload — não dependa de edições manuais:

- `.env.local` — variáveis de ambiente.
- `strapi-types.ts` — tipos TypeScript das content-types.

A versão de `strapi-types.ts` incluída no repositório serve apenas para o
projeto compilar de forma standalone.
