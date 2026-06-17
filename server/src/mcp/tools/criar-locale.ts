import { z } from '@strapi/utils';
import { defineTool } from '../define';
import { createContentTools } from '../../content-tools';

export default defineTool({
  name: 'mcp_chat_criar_locale',
  title: 'Create an i18n locale',
  description:
    'Create a locale (language). `code` must be a valid ISO code (e.g. "pt-BR", "es"). Idempotent: returns ok if it already exists.',
  resolveInputSchema: () => z.object({ code: z.string(), name: z.string().optional() }),
  resolveOutputSchema: () =>
    z.object({
      ok: z.boolean().optional(),
      code: z.string().optional(),
      name: z.string().optional(),
      existed: z.boolean().optional(),
      erro: z.string().optional(),
    }),
  auth: { policies: [{ action: 'plugin::i18n.locale.create' }] },
  createHandler: (strapi: any) => async ({ args }) => {
    const r = await createContentTools(strapi).criarLocale(args);
    return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
  },
});
