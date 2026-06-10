/**
 * Serviço de áudio: STT (Whisper) e TTS (OpenAI), via fetch (Node 18+ tem
 * FormData/Blob/fetch globais).
 * Usa OPENAI_API_KEY (a mesma chave usada no chat).
 */

export default ({ strapi }: { strapi: any }) => ({
  async transcribe(buffer: Buffer, mimetype: string, language?: string) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY não configurada no .env (necessária p/ áudio).');

    const ext = mimetype.includes('mp4')
      ? 'mp4'
      : mimetype.includes('ogg')
        ? 'ogg'
        : mimetype.includes('wav')
          ? 'wav'
          : 'webm';

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    // Só aceita um código válido (en|pt). Forçar o idioma ERRADO faz o Whisper
    // transcrever no idioma errado; em caso de dúvida, deixa em branco para
    // auto-detecção (confiável para áudios claros).
    const raw = Array.isArray(language) ? language[0] : language;
    const lang = raw === 'en' || raw === 'pt' ? raw : undefined;
    if (lang) form.append('language', lang);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new Error(`OpenAI STT: ${await res.text()}`);
    const data: any = await res.json();
    return { text: data.text as string };
  },

  async synthesize(text: string, voice = 'echo') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY não configurada no .env (necessária p/ áudio).');

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice, response_format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS: ${await res.text()}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { audio_base64: buffer.toString('base64'), content_type: 'audio/mpeg' };
  },
});
