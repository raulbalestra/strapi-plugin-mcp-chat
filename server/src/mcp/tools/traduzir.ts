import { z } from '@strapi/utils';
import { defineTool } from '../define';
import { createContentTools } from '../../content-tools';

export default defineTool({
  name: 'mcp_chat_traduzir',
  title: 'Translate localized content',
  description:
    'Translate localized content into one or more languages. Creates missing locales, translates field by field (long text is split and reassembled, never overflows) and publishes (only on content-types with Draft & Publish). Without uid/documentId, translates ALL localized content-types. Handles many locales at once.',
  resolveInputSchema: () =>
    z.object({
      target_locales: z.array(z.string()).min(1),
      source_locale: z.string().optional(),
      uid: z.string().optional(),
      documentId: z.string().optional(),
      publish: z.boolean().optional(),
    }),
  resolveOutputSchema: () =>
    z.object({
      ok: z.boolean().optional(),
      source: z.string().optional(),
      por_locale: z.array(z.any()).optional(),
      erro: z.string().optional(),
    }),
  auth: { policies: [{ action: 'plugin::content-manager.explorer.update' }] },
  createHandler: (strapi: any) => async ({ args }) => {
    const r = await createContentTools(strapi).traduzir(args);
    return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
  },
});
