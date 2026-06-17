/**
 * chat controller
 */

export default ({ strapi }: { strapi: any }) => ({
  async message(ctx: any) {
    const { messages, image, lang, previewUrl, autoPublish } = ctx.request.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return ctx.badRequest('Campo "messages" (array) é obrigatório.');
    }
    try {
      const result = await strapi
        .plugin('mcp-chat')
        .service('chat')
        .chat({ messages, image, lang, previewUrl, autoPublish });
      ctx.body = result;
    } catch (e: any) {
      strapi.log.error(`[mcp-chat] ${e?.message || e}`);
      return ctx.internalServerError(e?.message || 'Erro ao processar o chat.');
    }
  },
});
