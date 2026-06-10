/**
 * audio controller — STT (upload de áudio) e TTS (texto -> áudio).
 */

import { readFileSync } from 'fs';

export default ({ strapi }: { strapi: any }) => ({
  async stt(ctx: any) {
    const files = ctx.request.files || {};
    const file = files.audio || files.file;
    if (!file) return ctx.badRequest('Envie um arquivo de áudio no campo "audio".');

    const f = Array.isArray(file) ? file[0] : file;
    const buffer = f.filepath ? readFileSync(f.filepath) : f.buffer;
    const mimetype = f.mimetype || f.type || 'audio/webm';
    // Query primeiro (sempre chega); body multipart como fallback.
    const language = ctx.query?.language || ctx.request.body?.language;

    try {
      const result = await strapi
        .plugin('mcp-chat')
        .service('audio')
        .transcribe(buffer, mimetype, language);
      ctx.body = result;
    } catch (e: any) {
      strapi.log.error(`[mcp-chat:stt] ${e?.message || e}`);
      return ctx.internalServerError(e?.message || 'Erro na transcrição.');
    }
  },

  async tts(ctx: any) {
    const { text, voice } = ctx.request.body || {};
    if (!text) return ctx.badRequest('Campo "text" é obrigatório.');
    try {
      const result = await strapi
        .plugin('mcp-chat')
        .service('audio')
        .synthesize(text, voice);
      ctx.body = result;
    } catch (e: any) {
      strapi.log.error(`[mcp-chat:tts] ${e?.message || e}`);
      return ctx.internalServerError(e?.message || 'Erro na síntese de voz.');
    }
  },
});
