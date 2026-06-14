import { z } from '@strapi/utils';
import type { StrapiMcpToolModule } from '../types';
import { createContentTools } from '../../content-tools';

const tool: StrapiMcpToolModule = {
  register(registerTool) {
    registerTool({
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
  },
};

export default tool;
