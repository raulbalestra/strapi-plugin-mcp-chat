import { useRef, useState } from 'react';
import { Box, Flex, Typography, Button, Textarea, TextInput } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

type Msg = { role: 'user' | 'assistant'; content: string; image?: string | null };

const FALLBACK_PREVIEW_URL = 'http://localhost:3000';
const DEFAULT_PREVIEW_URL = (() => {
  try {
    return localStorage.getItem('mcp-chat-preview-url') || FALLBACK_PREVIEW_URL;
  } catch {
    return FALLBACK_PREVIEW_URL;
  }
})();

const HomePage = () => {
  const { post } = useFetchClient();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live preview
  const [previewOn, setPreviewOn] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(DEFAULT_PREVIEW_URL);
  const [iframeKey, setIframeKey] = useState(0);

  // Áudio
  const [voiceOn, setVoiceOn] = useState(false);
  const [recording, setRecording] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
      setError('Não foi possível iniciar o compartilhamento de tela.');
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
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  };

  // ── TTS playback ──────────────────────────────────────────────────────────
  const playTTS = async (text: string) => {
    try {
      const { data } = await post('/mcp-chat/tts', { text });
      const audio = new Audio(`data:${data.content_type};base64,${data.audio_base64}`);
      await audio.play().catch(() => undefined);
    } catch {
      /* silencioso — voz é opcional */
    }
  };

  // ── Enviar mensagem (texto vindo do input ou da transcrição) ───────────────
  const sendMessage = async (text: string) => {
    if (!text || loading) return;
    setError(null);

    const image = captureFrame();
    const next: Msg[] = [...messages, { role: 'user', content: text, image }];
    setMessages(next);
    setLoading(true);

    try {
      const payload = {
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        image,
      };
      const { data } = await post('/mcp-chat/message', payload);
      const reply = data?.reply || '(sem resposta)';
      setMessages((cur) => [...cur, { role: 'assistant', content: reply }]);
      if (previewOn) setIframeKey((k) => k + 1);
      if (voiceOn) playTTS(reply);
    } catch (e: any) {
      const detail =
        e?.response?.data?.error?.message || e?.message || 'Erro ao falar com a IA.';
      setError(detail);
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

  // ── STT: gravar microfone -> transcrever -> enviar ─────────────────────────
  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        await transcribeAndSend(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Não foi possível acessar o microfone.');
    }
  };
  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };
  const transcribeAndSend = async (blob: Blob) => {
    setLoading(true);
    try {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const form = new FormData();
      form.append('audio', blob, `audio.${ext}`);
      const { data } = await post('/mcp-chat/stt', form);
      const text = (data?.text || '').trim();
      setLoading(false);
      if (text) sendMessage(text);
      else setError('Não consegui entender o áudio.');
    } catch (e: any) {
      setLoading(false);
      setError(e?.response?.data?.error?.message || 'Erro na transcrição.');
    }
  };

  // ── UI ──────────────────────────────────────────────────────────────────
  const chatPanel = (
    <Flex direction="column" alignItems="stretch" gap={4} height="100%">
      <Flex justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="beta" tag="h1">MCP Chat</Typography>
          <Typography variant="pi" textColor="neutral600">
            IA via MCP {sharing ? '• vendo sua tela' : ''} {voiceOn ? '• voz ON' : ''}
          </Typography>
        </Box>
        <Flex gap={1}>
          <Button
            size="S"
            variant={voiceOn ? 'success-light' : 'tertiary'}
            onClick={() => setVoiceOn((v) => !v)}
          >
            {voiceOn ? 'Voz: ON' : 'Voz: OFF'}
          </Button>
          <Button
            size="S"
            variant={sharing ? 'danger-light' : 'secondary'}
            onClick={sharing ? stopShare : startShare}
          >
            {sharing ? 'Parar tela' : 'Compartilhar tela'}
          </Button>
        </Flex>
      </Flex>

      <Box
        background="neutral0"
        hasRadius
        shadow="tableShadow"
        padding={4}
        grow={1}
        style={{ overflowY: 'auto', minHeight: 240 }}
      >
        {messages.length === 0 && (
          <Typography textColor="neutral500">
            Escreva, fale (🎤) ou compartilhe a tela. Ex.: “Quais content-types existem?”.
          </Typography>
        )}
        <Flex direction="column" alignItems="stretch" gap={3}>
          {messages.map((m, i) => (
            <Box
              key={i}
              padding={3}
              hasRadius
              background={m.role === 'user' ? 'primary100' : 'neutral100'}
            >
              <Typography variant="sigma" textColor={m.role === 'user' ? 'primary600' : 'neutral600'}>
                {m.role === 'user' ? 'Você' : 'IA'}
              </Typography>
              <Box paddingTop={1}>
                <Typography style={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
              </Box>
              {m.image && (
                <Box paddingTop={2}>
                  <img
                    src={m.image}
                    alt="tela compartilhada"
                    style={{ maxWidth: '100%', borderRadius: 4, border: '1px solid #ddd' }}
                  />
                </Box>
              )}
            </Box>
          ))}
          {loading && <Typography textColor="neutral500">Processando…</Typography>}
        </Flex>
      </Box>

      {error && (
        <Box background="danger100" padding={3} hasRadius>
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      )}

      <Flex gap={2} alignItems="flex-end">
        <Button
          variant={recording ? 'danger-light' : 'tertiary'}
          onClick={recording ? stopRecording : startRecording}
        >
          {recording ? '⏹ Parar' : '🎤 Falar'}
        </Button>
        <Box grow={1}>
          <Textarea
            name="message"
            placeholder="Escreva… (Cmd/Ctrl+Enter envia)"
            value={input}
            onChange={(e: any) => setInput(e.target.value)}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
            }}
          />
        </Box>
        <Button onClick={send} loading={loading} disabled={!input.trim()}>
          Enviar
        </Button>
      </Flex>
    </Flex>
  );

  const previewPanel = (
    <Flex direction="column" alignItems="stretch" gap={2} height="100%">
      <Flex gap={2} alignItems="center">
        <Box grow={1}>
          <TextInput
            aria-label="URL do preview"
            value={previewUrl}
            onChange={(e: any) => setPreviewUrl(e.target.value)}
          />
        </Box>
        <Button size="S" variant="tertiary" onClick={() => setIframeKey((k) => k + 1)}>
          Recarregar
        </Button>
      </Flex>
      <Box
        background="neutral0"
        hasRadius
        shadow="tableShadow"
        grow={1}
        style={{ overflow: 'hidden', minHeight: 400 }}
      >
        <iframe
          key={iframeKey}
          src={previewUrl}
          title="Live Preview"
          style={{ width: '100%', height: '100%', border: 'none', minHeight: 400 }}
        />
      </Box>
    </Flex>
  );

  return (
    <Box padding={6} background="neutral100" style={{ minHeight: '100vh' }}>
      <video ref={videoRef} autoPlay muted style={{ display: 'none' }} />

      <Flex justifyContent="flex-end" paddingBottom={4}>
        <Button
          variant={previewOn ? 'success-light' : 'default'}
          onClick={() => setPreviewOn((v) => !v)}
        >
          {previewOn ? 'Live Preview: ON' : 'Live Preview: OFF'}
        </Button>
      </Flex>

      {previewOn ? (
        <Flex alignItems="stretch" gap={4} style={{ height: 'calc(100vh - 140px)' }}>
          <Box style={{ flex: '1 1 0', minWidth: 0 }}>{chatPanel}</Box>
          <Box style={{ flex: '1 1 0', minWidth: 0 }}>{previewPanel}</Box>
        </Flex>
      ) : (
        <Box style={{ maxWidth: 900, margin: '0 auto', height: 'calc(100vh - 140px)' }}>
          {chatPanel}
        </Box>
      )}
    </Box>
  );
};

export { HomePage };
