/**
 * Registra as ferramentas de conteúdo do plugin no MCP server NATIVO da Strapi
 * (>= 5.47.0), via `strapi.ai.mcp.registerTool`. Assim a busca/edição profunda
 * (componentes + dynamic zones) fica disponível para QUALQUER cliente MCP
 * (Cursor, etc.) — não só para o chat do admin.
 *
 * Importante: o registro precisa acontecer no `register()` do plugin, ANTES de
 * o MCP server iniciar (ordem de boot: register → bootstrap → MCP start).
 * O `z` (Zod) deve vir de `@strapi/utils` para evitar conflito de versões.
 */
import { z } from '@strapi/utils';
import { createContentTools } from './content-tools';

export function registerMcpTools(strapi: any) {
  const registerTool = strapi?.ai?.mcp?.registerTool;
  if (typeof registerTool !== 'function') {
    strapi.log.warn(
      '[mcp-chat] strapi.ai.mcp.registerTool indisponível — tools NÃO registradas no MCP nativo. ' +
        'Requer Strapi >= 5.47.0 com `mcp: { enabled: true }` em config/server.'
    );
    return;
  }

  const tools = createContentTools(strapi);
  const asResult = (r: any) => ({
    content: [{ type: 'text', text: JSON.stringify(r) }],
    structuredContent: r,
  });

  registerTool({
    name: 'mcp_chat_buscar_texto',
    title: 'Search text across content (deep)',
    description:
      'Search a phrase across ALL content-types, single types, components and dynamic zones (recursive, substring). Returns matches with a `path` (e.g. ["dynamic_zone",2,"heading"]) to pass to mcp_chat_editar_campo.',
    resolveInputSchema: () => z.object({ termo: z.string() }),
    resolveOutputSchema: () =>
      z.object({
        total: z.number().optional(),
        resultados: z.array(z.any()).optional(),
        erro: z.string().optional(),
      }),
    auth: { policies: [{ action: 'plugin::content-manager.explorer.read' }] },
    createHandler: () => async ({ args }: any) => asResult(await tools.buscarTexto(args?.termo)),
  });

  registerTool({
    name: 'mcp_chat_editar_campo',
    title: 'Edit a (possibly nested) field',
    description:
      'Edit a field value (saved as draft), including text nested in components/dynamic zones. Pass the `path` exactly as returned by mcp_chat_buscar_texto; for a simple top-level field you may use `campo`.',
    resolveInputSchema: () =>
      z.object({
        uid: z.string(),
        documentId: z.string(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
        campo: z.string().optional(),
        novo_valor: z.string(),
      }),
    resolveOutputSchema: () =>
      z.object({
        ok: z.boolean().optional(),
        uid: z.string().optional(),
        documentId: z.string().optional(),
        path: z.array(z.any()).optional(),
        novo_valor: z.string().optional(),
        erro: z.string().optional(),
      }),
    auth: { policies: [{ action: 'plugin::content-manager.explorer.update' }] },
    createHandler: () => async ({ args }: any) => asResult(await tools.editarCampo(args)),
  });

  registerTool({
    name: 'mcp_chat_publicar',
    title: 'Publish an entry',
    description: 'Publish an entry by uid + documentId, making the change visible on the site.',
    resolveInputSchema: () => z.object({ uid: z.string(), documentId: z.string() }),
    resolveOutputSchema: () =>
      z.object({
        ok: z.boolean().optional(),
        uid: z.string().optional(),
        documentId: z.string().optional(),
        status: z.string().optional(),
      }),
    auth: { policies: [{ action: 'plugin::content-manager.explorer.publish' }] },
    createHandler: () => async ({ args }: any) => asResult(await tools.publicar(args)),
  });

  strapi.log.info('[mcp-chat] 3 tools registradas no MCP nativo (mcp_chat_*).');
}
