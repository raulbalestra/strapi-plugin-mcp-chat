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
      {
        method: 'POST',
        path: '/frontend/analyze',
        handler: 'frontend.analyze',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/frontend/provision',
        handler: 'frontend.provision',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/frontend/status',
        handler: 'frontend.status',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/frontend/run',
        handler: 'frontend.run',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/frontend/run-status',
        handler: 'frontend.runStatus',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/frontend/integrate',
        handler: 'frontend.integrate',
        config: { policies: [] },
      },
      {
        method: 'POST',
        path: '/frontend/wire',
        handler: 'frontend.wire',
        config: { policies: [] },
      },
    ],
  },
};
