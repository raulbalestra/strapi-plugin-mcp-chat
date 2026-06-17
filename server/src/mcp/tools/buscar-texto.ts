import { z } from '@strapi/utils';
import { defineTool } from '../define';
import { createContentTools } from '../../content-tools';

export default defineTool({
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
  createHandler: (strapi: any) => async ({ args }) => {
    const r = await createContentTools(strapi).buscarTexto(args.termo);
    return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
  },
});
