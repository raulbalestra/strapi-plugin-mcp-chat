/**
 * Server entry do plugin mcp-chat.
 */

import chat from './controllers/chat';
import audio from './controllers/audio';
import chatService from './services/chat';
import audioService from './services/audio';
import routes from './routes';

export default {
  register() {},
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
