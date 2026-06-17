import { useRef, useState, useEffect } from 'react';
import { Box, Flex, Typography, Button, Loader, Textarea } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';
import { useLang, makeT } from '../i18n';
import { LangSwitcher } from '../components/LangSwitcher';
import { StackLogos } from '../components/StackLogos';

/**
 * Provisão de frontend em duas etapas (cenário Figma/Lovable, sem manifest):
 *  1. Analisar: sobe o .zip → o plugin extrai e, se não houver manifest, a IA o
 *     infere a partir do código. A UI mostra o manifest proposto para revisão.
 *  2. Provisionar: o usuário confirma (podendo editar o JSON) → cria as
 *     content-types, semeia, libera leitura e liga o preview (a Strapi reinicia).
 */

type Phase = 'idle' | 'analyzing' | 'review' | 'provisioning' | 'ready' | 'done-noreload' | 'error';

interface AnalyzeResp {
  ok: boolean;
  frontendDir: string;
  inferred: boolean;
  framework: string;
  filesAnalyzed: string[];
  manifest: any;
  errors: string[];
  message: string;
}

interface ProvisionDone {
  name: string;
  framework: string;
  frontendDir: string;
  contentTypes: string[];
  previewUrl: string;
  seedCreated: { uid: string; count: number }[];
  linkErrors: string[];
  finishedAt: string;
}

const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

const ProvisionPage = () => {
  const { post, get } = useFetchClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [lang] = useLang();
  const t = makeT(lang);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // resultado da análise / revisão
  const [frontendDir, setFrontendDir] = useState('');
  const [manifestText, setManifestText] = useState('');
  const [inferred, setInferred] = useState(false);
  const [framework, setFramework] = useState('');
  const [filesAnalyzed, setFilesAnalyzed] = useState<string[]>([]);

  const [done, setDone] = useState<ProvisionDone | null>(null);
  const [noReloadMsg, setNoReloadMsg] = useState('');

  // religamento (snapshot) do frontend ao Strapi
  const [integrating, setIntegrating] = useState(false);
  const [integrateMsg, setIntegrateMsg] = useState('');

  const stopRef = useRef(false);
  useEffect(() => () => { stopRef.current = true; }, []);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const errDetail = (e: any, fallback: string) => {
    const body = e?.response?.data;
    const base =
      body?.error?.message ||
      body?.message ||
      (Array.isArray(body?.errors) ? body.errors.join('; ') : null) ||
      e?.message ||
      fallback;
    const extra =
      body?.errors && Array.isArray(body.errors) && body?.message
        ? `\n• ${body.errors.join('\n• ')}`
        : '';
    return `${base}${extra}`;
  };

  // ── Etapa 1: analisar ──────────────────────────────────────────────────────
  const analyze = async () => {
    if (!file || phase === 'analyzing') return;
    setError(null);
    setDone(null);
    setPhase('analyzing');
    try {
      const form = new FormData();
      form.append('frontend', file, file.name);
      const { data } = await post('/mcp-chat/frontend/analyze', form);
      const res = data as AnalyzeResp;
      setFrontendDir(res.frontendDir);
      setInferred(res.inferred);
      setFramework(res.framework);
      setFilesAnalyzed(res.filesAnalyzed || []);
      setManifestText(res.manifest ? JSON.stringify(res.manifest, null, 2) : '');
      if (!res.ok && res.errors?.length) {
        setError(`${t('prov.analyzeWarn')}\n• ${res.errors.join('\n• ')}`);
      }
      setPhase('review');
    } catch (e: any) {
      setError(errDetail(e, t('prov.analyzeFail')));
      setPhase('error');
    }
  };

  // ── Etapa 2: provisionar ───────────────────────────────────────────────────
  const provision = async () => {
    let manifest: any;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      setError(t('prov.invalidJson'));
      return;
    }
    setError(null);
    setPhase('provisioning');
    try {
      const { data } = await post('/mcp-chat/frontend/provision', { frontendDir, manifest });
      if (data.willReload) {
        stopRef.current = false;
        void pollUntilReady();
      } else {
        setNoReloadMsg(data.message);
        setPhase('done-noreload');
      }
    } catch (e: any) {
      setError(errDetail(e, t('prov.provisionFail')));
      setPhase('error');
    }
  };

  const pollUntilReady = async () => {
    const startedAt = Date.now();
    while (!stopRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setError(t('prov.provisionFail'));
        setPhase('error');
        return;
      }
      await sleep(POLL_MS);
      try {
        const { data } = await get('/mcp-chat/frontend/status');
        if (data && data.pending === false && data.done) {
          setDone(data.done as ProvisionDone);
          setPhase('ready');
          return;
        }
      } catch {
        // servidor reiniciando: continua tentando.
      }
    }
  };

  const integrate = async () => {
    if (integrating) return;
    setIntegrating(true);
    setIntegrateMsg('');
    try {
      const { data } = await post('/mcp-chat/frontend/integrate', {});
      if (data.ok) {
        setIntegrateMsg(t('prov.relinkOk', { files: data.filesRewritten.join(', ') }));
      } else {
        setIntegrateMsg(t('prov.relinkFail', { err: (data.errors || []).join('; ') || t('prov.noData') }));
      }
    } catch (e: any) {
      setIntegrateMsg(`⚠️ ${errDetail(e, t('prov.relinkErr'))}`);
    } finally {
      setIntegrating(false);
    }
  };

  const reset = () => {
    setFile(null);
    setError(null);
    setDone(null);
    setManifestText('');
    setFrontendDir('');
    setFilesAnalyzed([]);
    setIntegrateMsg('');
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const busy = phase === 'analyzing' || phase === 'provisioning';

  return (
    <Box padding={6} background="neutral100" style={{ minHeight: '100vh' }}>
      <Flex justifyContent="space-between" alignItems="center" paddingBottom={4}>
        <Box>
          <Typography variant="alpha" tag="h1">{t('prov.title')}</Typography>
          <Typography variant="pi" textColor="neutral600">{t('prov.subtitle')}</Typography>
        </Box>
        <Flex gap={2} alignItems="center">
          <LangSwitcher />
          <Link to="..">
            <Button variant="tertiary">{t('prov.back')}</Button>
          </Link>
        </Flex>
      </Flex>

      <Box
        background="neutral0"
        hasRadius
        shadow="tableShadow"
        padding={6}
        style={{ maxWidth: 820, margin: '0 auto' }}
      >
        <Flex direction="column" alignItems="stretch" gap={4}>
          {/* Stacks suportados */}
          <Box>
            <Typography variant="sigma" textColor="neutral600" tag="div">{t('prov.supported')}</Typography>
            <Box paddingTop={2}><StackLogos /></Box>
          </Box>

          <Box height="1px" background="neutral200" />

          {/* Seleção do arquivo */}
          <Typography variant="delta" tag="h2">{t('prov.step1')}</Typography>
          <Typography textColor="neutral600">{t('prov.step1desc')}</Typography>

          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              setError(null);
              setDone(null);
              setPhase('idle');
              setManifestText('');
              setFile(e.target.files?.[0] ?? null);
            }}
          />

          <Flex gap={2} alignItems="center">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              {t('prov.selectFile')}
            </Button>
            <Typography textColor={file ? 'neutral800' : 'neutral500'}>
              {file ? file.name : t('prov.noFile')}
            </Typography>
          </Flex>

          {(phase === 'idle' || phase === 'analyzing') && (
            <Box paddingTop={2}>
              <Button onClick={analyze} loading={phase === 'analyzing'} disabled={!file || busy}>
                {t('prov.analyze')}
              </Button>
            </Box>
          )}

          {phase === 'analyzing' && (
            <Flex gap={3} alignItems="center" background="primary100" padding={4} hasRadius>
              <Loader small>{t('prov.analyzing')}</Loader>
              <Typography textColor="primary700">{t('prov.analyzingDesc')}</Typography>
            </Flex>
          )}

          {/* Etapa 2: revisão do manifest */}
          {phase === 'review' && (
            <>
              <Box height="1px" background="neutral200" />
              <Typography variant="delta" tag="h2">{t('prov.step2')}</Typography>
              <Flex gap={2} alignItems="center" wrap="wrap">
                <Box background={inferred ? 'warning100' : 'success100'} padding={2} hasRadius>
                  <Typography variant="pi" textColor={inferred ? 'warning700' : 'success700'}>
                    {inferred ? t('prov.inferred') : t('prov.fromManifest')} • {t('prov.framework')}: {framework}
                  </Typography>
                </Box>
                {filesAnalyzed.length > 0 && (
                  <Typography variant="pi" textColor="neutral600">
                    {t('prov.analyzed')}: {filesAnalyzed.slice(0, 6).join(', ')}
                    {filesAnalyzed.length > 6 ? ` +${filesAnalyzed.length - 6}` : ''}
                  </Typography>
                )}
              </Flex>
              <Typography variant="pi" textColor="neutral600">{t('prov.editJson')}</Typography>
              <Textarea
                name="manifest"
                value={manifestText}
                onChange={(e: any) => setManifestText(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 320 }}
              />
              <Flex gap={2}>
                <Button onClick={provision} disabled={!manifestText.trim()}>
                  {t('prov.provision')}
                </Button>
                <Button variant="tertiary" onClick={reset}>{t('prov.restart')}</Button>
              </Flex>
            </>
          )}

          {/* Provisionando */}
          {phase === 'provisioning' && (
            <Flex direction="column" gap={2} background="primary100" padding={4} hasRadius>
              <Flex gap={3} alignItems="center">
                <Loader small>{t('prov.provisioning')}</Loader>
                <Typography fontWeight="bold" textColor="primary700">{t('prov.provisioningTitle')}</Typography>
              </Flex>
              <Typography variant="pi" textColor="neutral700">{t('prov.provisioningDesc')}</Typography>
            </Flex>
          )}

          {phase === 'done-noreload' && (
            <Box background="success100" padding={4} hasRadius>
              <Typography textColor="success700">{noReloadMsg}</Typography>
            </Box>
          )}

          {/* Pronto */}
          {phase === 'ready' && done && (
            <Box background="success100" padding={4} hasRadius>
              <Typography variant="beta" textColor="success700" tag="div">
                {t('prov.doneTitle')}
              </Typography>
              <Box paddingTop={3}>
                <Typography variant="pi" textColor="neutral700" tag="div">
                  {t('prov.typesCreated')} {done.contentTypes.join(', ')}
                </Typography>
                {done.seedCreated.length > 0 && (
                  <Typography variant="pi" textColor="neutral700" tag="div">
                    {t('prov.seeded')} {done.seedCreated.map((s) => `${s.uid} (${s.count})`).join(', ')}
                  </Typography>
                )}
                <Typography variant="pi" textColor="neutral700" tag="div">
                  {t('prov.frontendAt')} <code>{done.frontendDir}</code>
                </Typography>
              </Box>
              <Box paddingTop={3}>
                <Typography variant="pi" textColor="neutral700" tag="div">
                  {t('prov.runFrontend')}
                </Typography>
                <Box background="neutral0" padding={2} hasRadius marginTop={1}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  cd {done.frontendDir} && npm install && npm run dev
                </Box>
              </Box>
              <Box paddingTop={3}>
                <Typography variant="pi" textColor="neutral700" tag="div">
                  {t('prov.relinkDesc')}
                </Typography>
                <Box paddingTop={1}>
                  <Button onClick={integrate} loading={integrating} variant="default">
                    {t('prov.relink')}
                  </Button>
                </Box>
                {integrateMsg && (
                  <Box paddingTop={2}>
                    <Typography variant="pi" textColor="neutral800" style={{ whiteSpace: 'pre-wrap' }}>
                      {integrateMsg}
                    </Typography>
                  </Box>
                )}
              </Box>

              <Flex gap={2} paddingTop={3}>
                <a href={done.previewUrl} target="_blank" rel="noreferrer">
                  <Button variant="success">{t('prov.open')} {done.previewUrl} ↗</Button>
                </a>
                <Button variant="tertiary" onClick={reset}>{t('prov.provisionAnother')}</Button>
              </Flex>
            </Box>
          )}

          {error && (
            <Box background={phase === 'error' ? 'danger100' : 'warning100'} padding={3} hasRadius>
              <Typography textColor={phase === 'error' ? 'danger600' : 'warning700'}
                style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </Typography>
            </Box>
          )}
        </Flex>
      </Box>
    </Box>
  );
};

export { ProvisionPage };
