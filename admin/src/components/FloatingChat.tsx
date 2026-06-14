/**
 * Chat flutuante global do admin: aparece em TODAS as telas (montado no body),
 * ancorado à direita por padrão e arrastável pela barra de título.
 * Autossuficiente (HTML/CSS puro, sem providers do admin). Autentica com o
 * mesmo JWT do admin via getFetchClient.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { getFetchClient } from '@strapi/strapi/admin';

type Msg = { role: 'user' | 'assistant'; content: string; image?: string | null };
type Pos = { x: number; y: number };

type Props = {
  previewOn: boolean;
  previewUrl: string;
  onTogglePreview: () => void;
  /** chamado após uma resposta; didWrite indica que houve edição no Strapi. */
  onReply: (didWrite: boolean) => void;
};

const W = 380;

type Lang = 'pt' | 'en';

const STR: Record<Lang, Record<string, string>> = {
  pt: {
    fab: 'Abrir MCP Chat', minimize: 'Minimizar',
    rec: '🎤 Enviar áudio', recStop: '⏹ Parar áudio', recTitle: 'Gravar áudio e enviar (transcreve e manda)',
    previewOn: '🖼 Preview: ON', previewOff: '🖼 Preview: OFF', previewTitle: 'Abrir/fechar o preview do site ao lado da Strapi',
    voiceOn: '🔊 Voz: ON', voiceOff: '🔈 Voz: OFF', voiceTitle: 'Ler as respostas em voz alta (TTS)',
    shareOn: '🛑 Parar tela', shareOff: '🖥 Compart. tela', shareTitle: 'Compartilhar a tela com a IA',
    langTitle: 'Idioma do chat e da voz (PT-BR ↔ English)',
    seeingScreen: '• vendo sua tela ', voiceStatus: '• voz ON',
    empty: 'Escreva, fale (🎤) ou compartilhe a tela. Ex.: “troque o texto X por Y e publique”.',
    you: 'Você', ai: 'IA', processing: 'Processando…',
    placeholder: 'Escreva… (Cmd/Ctrl+Enter)', sendBtn: 'Enviar',
    errShare: 'Não foi possível iniciar o compartilhamento de tela.',
    errMic: 'Não foi possível acessar o microfone.',
    errStt: 'Erro na transcrição.', errAudioEmpty: 'Não consegui entender o áudio.',
    errChat: 'Erro ao falar com a IA.',
  },
  en: {
    fab: 'Open MCP Chat', minimize: 'Minimize',
    rec: '🎤 Send audio', recStop: '⏹ Stop audio', recTitle: 'Record audio and send (transcribes and sends)',
    previewOn: '🖼 Preview: ON', previewOff: '🖼 Preview: OFF', previewTitle: 'Toggle the site preview next to Strapi',
    voiceOn: '🔊 Voice: ON', voiceOff: '🔈 Voice: OFF', voiceTitle: 'Read replies out loud (TTS)',
    shareOn: '🛑 Stop screen', shareOff: '🖥 Share screen', shareTitle: 'Share your screen with the AI',
    langTitle: 'Chat and voice language (PT-BR ↔ English)',
    seeingScreen: '• seeing your screen ', voiceStatus: '• voice ON',
    empty: 'Type, speak (🎤) or share your screen. E.g.: “replace text X with Y and publish”.',
    you: 'You', ai: 'AI', processing: 'Processing…',
    placeholder: 'Type… (Cmd/Ctrl+Enter)', sendBtn: 'Send',
    errShare: 'Could not start screen sharing.',
    errMic: 'Could not access the microphone.',
    errStt: 'Transcription error.', errAudioEmpty: 'I could not understand the audio.',
    errChat: 'Error talking to the AI.',
  },
};

export const FloatingChat = ({ previewOn, previewUrl, onTogglePreview, onReply }: Props) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null); // null = ancorado à direita
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lang, setLang] = useState<Lang>(() => {
    try { return (localStorage.getItem('mcp-chat-lang') as Lang) || 'en'; } catch { return 'en'; }
  });
  const t = STR[lang];
  useEffect(() => { try { localStorage.setItem('mcp-chat-lang', lang); } catch { /* noop */ } }, [lang]);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // ── Drag ────────────────────────────────────────────────────────────────
  const onHeaderDown = (e: React.MouseEvent) => {
    const startX = pos?.x ?? window.innerWidth - W - 24;
    const startY = pos?.y ?? 88;
    dragRef.current = { dx: e.clientX - startX, dy: e.clientY - startY };
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragRef.current.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy));
      setPos({ x, y });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, loading]);

  // ── Screenshare ───────────────────────────────────────────────────────────
  const startShare = async () => {
    setError(null);
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      stream.getVideoTracks()[0].addEventListener('ended', stopShare);
      setSharing(true);
    } catch {
      setError(t.errShare);
    }
  };
  const stopShare = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
  };
  const captureFrame = (): string | null => {
    const video = videoRef.current;
    if (!sharing || !video || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    // Reduz a resolução e usa JPEG comprimido para o payload não estourar o
    // limite do corpo da requisição (evita o erro 413 "request entity too large").
    const scale = Math.min(1, 1100 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  // ── TTS ────────────────────────────────────────────────────────────────────
  const playTTS = async (text: string) => {
    try {
      const { post } = getFetchClient();
      const { data } = await post('/mcp-chat/tts', { text });
      const audio = new Audio(`data:${data.content_type};base64,${data.audio_base64}`);
      await audio.play().catch(() => undefined);
    } catch { /* voz é opcional */ }
  };

  // ── Enviar ──────────────────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text || loading) return;
    setError(null);
    const image = captureFrame();
    const next: Msg[] = [...messages, { role: 'user', content: text, image }];
    setMessages(next);
    setLoading(true);
    try {
      const { post } = getFetchClient();
      const { data } = await post('/mcp-chat/message', {
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        image,
        lang,
        // Página que o usuário está olhando no preview (se aberto). Dá à IA o
        // contexto do "isso aqui" sem precisar varrer o site inteiro.
        previewUrl: previewOn ? previewUrl : null,
      });
      const reply = data?.reply || '(sem resposta)';
      setMessages((cur) => [...cur, { role: 'assistant', content: reply }]);
      onReply(!!data?.didWrite);
      if (voiceOn) playTTS(reply);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || t.errChat);
    } finally {
      setLoading(false);
    }
  };
  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendMessage(text);
  };

  // ── STT ──────────────────────────────────────────────────────────────────────
  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        await transcribeAndSend(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError(t.errMic);
    }
  };
  const stopRecording = () => { recorderRef.current?.stop(); setRecording(false); };
  const transcribeAndSend = async (blob: Blob) => {
    setLoading(true);
    try {
      const { post } = getFetchClient();
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const form = new FormData();
      form.append('audio', blob, `audio.${ext}`);
      form.append('language', lang);
      // Idioma também na query: campos multipart nem sempre chegam em
      // ctx.request.body, mas a query string nunca se perde. Garante que o
      // Whisper transcreve no idioma escolhido (PT ou EN), não outro.
      const { data } = await post(`/mcp-chat/stt?language=${lang}`, form);
      const text = (data?.text || '').trim();
      setLoading(false);
      if (text) sendMessage(text);
      else setError(t.errAudioEmpty);
    } catch (e: any) {
      setLoading(false);
      setError(e?.response?.data?.error?.message || t.errStt);
    }
  };

  // ── Estilos ──────────────────────────────────────────────────────────────────
  const anchor: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 24, top: 88 };

  const btn = (active = false): React.CSSProperties => ({
    border: '1px solid #dcdce4', background: active ? '#4945ff' : '#fff',
    color: active ? '#fff' : '#32324d', borderRadius: 6, padding: '4px 8px',
    fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={t.fab}
        style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 2147483000,
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: '#4945ff', color: '#fff', fontSize: 24, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        }}
      >💬</button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', ...anchor, width: W, zIndex: 2147483000,
        display: 'flex', flexDirection: 'column',
        maxHeight: 'calc(100vh - 110px)',
        background: '#fff', border: '1px solid #dcdce4', borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.25)', overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      <video ref={videoRef} autoPlay muted style={{ display: 'none' }} />

      {/* Header / drag handle */}
      <div
        onMouseDown={onHeaderDown}
        style={{
          cursor: 'move', background: '#181826', color: '#fff',
          padding: '8px 10px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <strong style={{ fontSize: 13 }}>MCP Chat</strong>
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            {sharing ? t.seeingScreen : ''}{voiceOn ? t.voiceStatus : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Seletor de idioma — sempre visível no cabeçalho */}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setLang((l) => (l === 'pt' ? 'en' : 'pt'))}
            title={t.langTitle}
            style={{
              border: '1px solid #4a4a6a', background: '#2a2a45', color: '#fff',
              borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
            }}
          >
            {lang === 'pt' ? '🌐 PT-BR' : '🌐 English'}
          </button>
          <button onClick={() => setOpen(false)} title={t.minimize}
            style={{ ...btn(), padding: '2px 8px' }}>—</button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid #eaeaef', flexWrap: 'wrap' }}>
        <button style={btn(recording)} onClick={recording ? stopRecording : startRecording}
          title={t.recTitle}>
          {recording ? t.recStop : t.rec}
        </button>
        <button style={btn(previewOn)} onClick={onTogglePreview}
          title={t.previewTitle}>
          {previewOn ? t.previewOn : t.previewOff}
        </button>
        <button style={btn(voiceOn)} onClick={() => setVoiceOn((v) => !v)}
          title={t.voiceTitle}>
          {voiceOn ? t.voiceOn : t.voiceOff}
        </button>
        <button style={btn(sharing)} onClick={sharing ? stopShare : startShare}
          title={t.shareTitle}>
          {sharing ? t.shareOn : t.shareOff}
        </button>
      </div>

      {/* Mensagens */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 10, minHeight: 200, background: '#f6f6f9' }}>
        {messages.length === 0 && (
          <p style={{ color: '#8e8ea9', fontSize: 13 }}>{t.empty}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: 8, padding: 8, borderRadius: 6,
            background: m.role === 'user' ? '#eaf0ff' : '#fff',
            border: '1px solid #eaeaef',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: m.role === 'user' ? '#4945ff' : '#666687', marginBottom: 2 }}>
              {m.role === 'user' ? t.you : t.ai}
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: '#32324d' }}>{m.content}</div>
            {m.image && <img src={m.image} alt="screen" style={{ maxWidth: '100%', borderRadius: 4, marginTop: 6, border: '1px solid #ddd' }} />}
          </div>
        ))}
        {loading && <p style={{ color: '#8e8ea9', fontSize: 13 }}>{t.processing}</p>}
      </div>

      {error && (
        <div style={{ background: '#fcecea', color: '#d02b20', padding: '6px 10px', fontSize: 12 }}>{error}</div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #eaeaef' }}>
        <textarea
          value={input}
          placeholder={t.placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          rows={2}
          style={{ flex: 1, resize: 'none', border: '1px solid #dcdce4', borderRadius: 6, padding: 6, fontSize: 13, fontFamily: 'inherit' }}
        />
        <button onClick={send} disabled={loading || !input.trim()}
          style={{ ...btn(true), opacity: loading || !input.trim() ? 0.5 : 1, padding: '0 12px' }}>
          {loading ? '…' : t.sendBtn}
        </button>
      </div>
    </div>
  );
};
