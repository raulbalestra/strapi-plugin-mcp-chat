import { z } from '@strapi/utils';
import type { StrapiMcpToolModule } from '../types';
import { createContentTools } from '../../content-tools';

const tool: StrapiMcpToolModule = {
  register(registerTool) {
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
      createHandler: (strapi: any) => async ({ args }: any) => {
        const r = await createContentTools(strapi).publicar(args);
        return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
      },
    });
  },
};

export default tool;
