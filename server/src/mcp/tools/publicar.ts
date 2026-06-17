import { z } from '@strapi/utils';
import { defineTool } from '../define';
import { createContentTools } from '../../content-tools';

export default defineTool({
  name: 'mcp_chat_publicar',
  title: 'Publish an entry',
  description:
    'Publish an entry by uid + documentId, making the change visible on the site. Pass `locale` to publish a specific language, or "*" for all. For content-types without Draft & Publish there is nothing to publish (returns status "no-draft-publish") — the edit is already live.',
  resolveInputSchema: () =>
    z.object({ uid: z.string(), documentId: z.string(), locale: z.string().optional() }),
  resolveOutputSchema: () =>
    z.object({
      ok: z.boolean().optional(),
      uid: z.string().optional(),
      documentId: z.string().optional(),
      status: z.string().optional(),
      locale: z.string().optional(),
    }),
  auth: { policies: [{ action: 'plugin::content-manager.explorer.publish' }] },
  createHandler: (strapi: any) => async ({ args }) => {
    const r = await createContentTools(strapi).publicar(args);
    return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
  },
});
