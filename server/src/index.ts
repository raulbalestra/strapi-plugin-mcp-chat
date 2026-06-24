/**
 * Server entry do plugin mcp-chat.
 */

import chat from './controllers/chat';
import audio from './controllers/audio';
import frontend from './controllers/frontend';
import chatService from './services/chat';
import audioService from './services/audio';
import routes from './routes';
import register from './register';
import { runPendingProvision } from './provision/orchestrate';
import { stopFrontend, cleanupStaleFrontend } from './provision/runner';

export default {
  register,
  async bootstrap({ strapi }: { strapi: any }) {
    // Limpa qualquer dev server do front que tenha sobrado de uma execução
    // anterior (crash/SIGKILL não roda o destroy). Garante "limpar ao desligar"
    // mesmo em shutdown sujo e evita o EADDRINUSE no próximo Preview.
    try {
      cleanupStaleFrontend(strapi.dirs.app.root);
    } catch { /* best-effort */ }

    // Após um restart causado por um upload de frontend, conclui a provisão:
    // semeia o conteúdo e liga o preview. Idempotente (no-op se não há pendência).
    try {
      const r = await runPendingProvision(strapi, strapi.dirs.app.root);
      if (r.ran) {
        strapi.log.info(
          `[mcp-chat] provisão concluída: seed=${JSON.stringify(r.seed?.created ?? [])} link=${r.link?.previewAction ?? 'n/a'}`
        );
        if (r.errors.length) strapi.log.warn(`[mcp-chat] provisão com avisos: ${r.errors.join('; ')}`);
      }
    } catch (e: any) {
      strapi.log.error(`[mcp-chat] runPendingProvision falhou: ${e?.message ?? e}`);
    }
  },
  destroy() {
    // encerra o dev server do frontend (se foi iniciado pelo preview).
    // Nunca deixa o shutdown do Strapi falhar por causa disto.
    try {
      stopFrontend();
    } catch {
      /* shutdown best-effort */
    }
  },
  config: {
    default: {},
    validator() {},
  },
  controllers: { chat, audio, frontend },
  routes,
  services: { chat: chatService, audio: audioService },
};
