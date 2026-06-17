import { z } from '@strapi/utils';
import { defineTool } from '../define';
import { createContentTools } from '../../content-tools';

export default defineTool({
  name: 'mcp_chat_listar_locales',
  title: 'List i18n locales',
  description: 'List the configured locales (languages) and which one is the default.',
  resolveInputSchema: () => z.object({}),
  resolveOutputSchema: () =>
    z.object({
      default: z.string().optional(),
      locales: z.array(z.any()).optional(),
      erro: z.string().optional(),
    }),
  auth: { policies: [{ action: 'plugin::content-manager.explorer.read' }] },
  createHandler: (strapi: any) => async () => {
    const r = await createContentTools(strapi).listarLocales();
    return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
  },
});
