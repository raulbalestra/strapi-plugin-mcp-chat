/**
 * Rotas do plugin (tipo admin: exigem um admin autenticado).
 * Ficam montadas sob /mcp-chat.
 */

export default {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'POST',
        path: '/message',
        handler: 'chat.message',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/stt',
        handler: 'audio.stt',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/tts',
        handler: 'audio.tts',
        config: { policies: [] },
      },
    ],
  },
};
