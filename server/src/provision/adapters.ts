import type { Framework, Manifest } from './manifest';

/**
 * Adapters de framework.
 *
 * O contrato e o pipeline são idênticos para Next e TanStack; só mudam os
 * detalhes de cada ecossistema (nome do arquivo .env, prefixo das vars que vão
 * pro client, porta padrão). Isolar isso aqui é o que permite suportar os dois
 * sem ifs espalhados pelo código.
 *
 * Regra de segurança das env: a URL do Strapi é pública (prefixo do framework),
 * mas TOKEN e SECRET nunca recebem prefixo público — ficam só no servidor.
 */

export interface LinkContext {
  /** URL base do Strapi, ex.: http://localhost:1337 */
  strapiUrl: string;
  /** URL base do frontend, ex.: http://localhost:3000 (default = porta do adapter). */
  frontendUrl?: string;
  /** API token para o client (opcional; pode ser preenchido depois). */
  apiToken?: string;
  /** segredo do preview (draft mode). */
  previewSecret?: string;
}

export interface FrameworkAdapter {
  framework: Framework;
  /** arquivo de env que o framework lê. */
  envFileName: string;
  /** porta padrão de dev do framework. */
  defaultPort: number;
  /** monta as variáveis de ambiente do frontend. */
  buildEnv(ctx: LinkContext): Record<string, string>;
  /** dica de onde montar o PreviewBridge (usada na doc/log). */
  previewBridgeHint: string;
}

const nextAdapter: FrameworkAdapter = {
  framework: 'next',
  envFileName: '.env.local',
  defaultPort: 3000,
  buildEnv: ({ strapiUrl, apiToken, previewSecret }) => {
    const env: Record<string, string> = {
      // pública: usada por Server e Client Components
      NEXT_PUBLIC_STRAPI_URL: strapiUrl,
    };
    // server-only (sem NEXT_PUBLIC_): nunca vai pro bundle do client
    if (apiToken) env.STRAPI_API_TOKEN = apiToken;
    if (previewSecret) env.PREVIEW_SECRET = previewSecret;
    return env;
  },
  previewBridgeHint:
    'app/_components/PreviewBridge.tsx montado no layout raiz (postMessage para o admin)',
};

const tanstackAdapter: FrameworkAdapter = {
  framework: 'tanstack',
  envFileName: '.env',
  defaultPort: 5173,
  buildEnv: ({ strapiUrl, apiToken, previewSecret }) => {
    const env: Record<string, string> = {
      // pública no Vite/TanStack: exposta via import.meta.env
      VITE_STRAPI_URL: strapiUrl,
    };
    // server-only (sem VITE_): só acessível em loaders/server functions
    if (apiToken) env.STRAPI_API_TOKEN = apiToken;
    if (previewSecret) env.PREVIEW_SECRET = previewSecret;
    return env;
  },
  previewBridgeHint:
    'src/components/PreviewBridge.tsx montado no __root (postMessage para o admin)',
};

const ADAPTERS: Record<Framework, FrameworkAdapter> = {
  next: nextAdapter,
  tanstack: tanstackAdapter,
};

export function getAdapter(framework: Framework): FrameworkAdapter {
  return ADAPTERS[framework];
}

export function adapterForManifest(manifest: Manifest): FrameworkAdapter {
  return getAdapter(manifest.framework);
}
