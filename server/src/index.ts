/**
 * Server entry do plugin mcp-chat.
 */

import chat from './controllers/chat';
import audio from './controllers/audio';
import chatService from './services/chat';
import audioService from './services/audio';
import routes from './routes';
import { registerMcpTools } from './mcp';

export default {
  register({ strapi }: { strapi: any }) {
    // Estende o MCP nativo registrando as tools de conteúdo do plugin.
    // Tem que ser no register() (antes de o MCP server iniciar).
    registerMcpTools(strapi);
  },
  bootstrap() {},
  destroy() {},
  config: {
    default: {},
    validator() {},
  },
  controllers: { chat, audio },
  routes,
  services: { chat: chatService, audio: audioService },
};
