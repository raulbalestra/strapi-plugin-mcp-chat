import { z } from '@strapi/utils';
import type { StrapiMcpToolModule } from '../types';
import { enableI18n } from '../../provision/enable-i18n';

const tool: StrapiMcpToolModule = {
  register(registerTool) {
    registerTool({
      name: 'mcp_chat_habilitar_i18n',
      title: 'Enable i18n on a content-type',
      description:
        'Enable translation on content-types not localized yet: marks the content-type and its textual fields/components as localized. Required before translating content provisioned without i18n. Omit `uid` (or pass "*") to enable ALL content-types at once. Edits the schema (dev-only); Strapi restarts.',
      resolveInputSchema: () =>
        z.object({ uid: z.string().optional(), campos: z.array(z.string()).optional() }),
      resolveOutputSchema: () =>
        z.object({
          ok: z.boolean().optional(),
          uid: z.string().optional(),
          campos: z.array(z.string()).optional(),
          contentTypes: z.array(z.any()).optional(),
          total: z.number().optional(),
          restart: z.boolean().optional(),
          erro: z.string().optional(),
        }),
      auth: { policies: [{ action: 'plugin::content-type-builder.read' }] },
      createHandler: (strapi: any) => async ({ args }: any) => {
        const r = enableI18n({ strapi, uid: args?.uid, campos: args?.campos });
        return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
      },
    });
  },
};

export default tool;
