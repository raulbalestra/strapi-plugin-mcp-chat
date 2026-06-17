import { z } from '@strapi/utils';
import { defineTool } from '../define';
import { createContentTools } from '../../content-tools';

export default defineTool({
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
      locale: z.string().optional(),
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
  createHandler: (strapi: any) => async ({ args }) => {
    const r = await createContentTools(strapi).editarCampo(args);
    return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
  },
});
