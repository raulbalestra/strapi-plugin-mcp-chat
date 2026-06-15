import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Roda o dev server do frontend provisionado, a pedido da UI (quando o usuário
 * liga o preview). Detecta o gerenciador de pacotes, instala se preciso e sobe
 * `dev`, reportando o estado para a UI mostrar o "carregando" até subir.
 *
 * ROBUSTEZ DE PORTA/HOST (evita o 426 "Upgrade Required" e iframe em branco):
 *  - Escolhe uma porta LIVRE em 127.0.0.1 (pula qualquer outro app que já ocupe
 *    a porta padrão do framework — ex.: outro Vite na 5173).
 *  - Sobe o dev server fixado em 127.0.0.1 (IPv4 explícito) com a flag de porta
 *    do framework, e o preview usa EXATAMENTE essa URL — sem depender da
 *    resolução ambígua de "localhost" (IPv4 vs IPv6).
 *
 * Só roda em dev; o controller valida o caminho. O filho morre com a Strapi.
 */

export type RunState = 'idle' | 'installing' | 'starting' | 'running' | 'error';

export interface RunInfo {
  state: RunState;
  dir: string | null;
  url: string | null;
  pm: string | null;
  error: string | null;
  log: string[];
}

let info: RunInfo = { state: 'idle', dir: null, url: null, pm: null, error: null, log: [] };
let child: ChildProcess | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function detectPM(dir: string): string {
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

const has = (dir: string, ...names: string[]) => names.some((n) => fs.existsSync(path.join(dir, n)));

/** Detecta o framework pelo arquivo de config, p/ passar a flag de porta certa. */
function detectFramework(dir: string): 'vite' | 'next' | 'other' {
  if (has(dir, 'next.config.js', 'next.config.ts', 'next.config.mjs')) return 'next';
  if (has(dir, 'vite.config.js', 'vite.config.ts', 'vite.config.mjs')) return 'vite';
  return 'other';
}

/**
 * Porta-base do dev server do FRONTEND no preview. Propositalmente longe de:
 *  - 5173 (Vite do PAINEL ADMIN do próprio Strapi 5 em `strapi develop`),
 *  - 3000 (Next default) e 1337 (Strapi).
 * Evita colisão com o admin do Strapi (que responde 426 a requests não-WS).
 */
const FRONTEND_BASE_PORT = 4321;

/** Acha uma porta TCP livre a partir de `start`, testando em 0.0.0.0 (pega
 *  ocupações em `*:porta` de qualquer interface IPv4). */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (p: number) => {
      if (p > start + 200) return resolve(start); // desistência improvável
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.once('listening', () => srv.close(() => resolve(p)));
      srv.listen(p, '0.0.0.0');
    };
    tryPort(start);
  });
}

function pushLog(s: string) {
  for (const line of String(s).split('\n')) {
    const t = line.trim();
    if (t) info.log.push(t);
  }
  if (info.log.length > 60) info.log = info.log.slice(-60);
}

async function urlUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET' });
    // 2xx/3xx = app de verdade. 426 (Upgrade Required) e 5xx = servidor errado
    // ou não pronto → NÃO considerar no ar.
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

export function getRunStatus(): RunInfo {
  return { ...info, log: info.log.slice(-15) };
}

export function stopFrontend(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (child) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    child = null;
  }
  if (info.state !== 'error') info.state = 'idle';
}

export async function startFrontend(_strapi: any, opts: { dir: string; url: string }): Promise<RunInfo> {
  const { dir } = opts;

  // idempotente: já rodando/subindo para o mesmo dir
  if (child && info.dir === dir && ['installing', 'starting', 'running'].includes(info.state)) {
    return getRunStatus();
  }
  stopFrontend(); // troca de projeto / reinício limpo

  const pm = detectPM(dir);
  const framework = detectFramework(dir);
  // porta livre numa faixa dedicada (longe de 5173/3000/1337) — evita colidir
  // com o Vite do admin do Strapi e outros servidores.
  const port = await findFreePort(FRONTEND_BASE_PORT);
  const url = `http://127.0.0.1:${port}`;

  info = { state: 'installing', dir, url, pm, error: null, log: [] };

  const spawnIn = (cmd: string, args: string[]) =>
    spawn(cmd, args, { cwd: dir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

  // flags p/ fixar host+porta por framework
  const fwArgs =
    framework === 'next'
      ? ['-H', '127.0.0.1', '-p', String(port)]
      : framework === 'vite'
        ? ['--host', '127.0.0.1', '--port', String(port), '--strictPort']
        : ['--port', String(port)];
  // yarn repassa args direto; os demais precisam do separador "--"
  const devArgs = pm === 'yarn' ? ['dev', ...fwArgs] : ['run', 'dev', '--', ...fwArgs];

  const startDev = () => {
    info.state = 'starting';
    child = spawnIn(pm, devArgs);
    child.stdout?.on('data', (d) => pushLog(d));
    child.stderr?.on('data', (d) => pushLog(d));
    child.on('exit', (code) => {
      // processo morreu → frontend DOWN. Zera o child e libera o estado p/ que
      // apertar Preview de novo reinicie (em vez de ficar preso em "running").
      child = null;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (info.state === 'running') info.state = 'idle';
      else { info.state = 'error'; info.error = `dev encerrou (código ${code}). Veja o log.`; }
    });
    // confirma que subiu fazendo polling no próprio URL (127.0.0.1:porta)
    pollTimer = setInterval(async () => {
      if (await urlUp(url)) {
        info.state = 'running';
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
    }, 1500);
  };

  const needInstall = !fs.existsSync(path.join(dir, 'node_modules'));
  if (needInstall) {
    pushLog(`Instalando dependências com ${pm}…`);
    const installArgs = pm === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['install'];
    const inst = spawnIn(pm, installArgs);
    inst.stdout?.on('data', (d) => pushLog(d));
    inst.stderr?.on('data', (d) => pushLog(d));
    inst.on('exit', (code) => {
      if (code === 0) startDev();
      else { info.state = 'error'; info.error = `instalação falhou (código ${code}). Veja o log.`; }
    });
  } else {
    startDev();
  }

  return getRunStatus();
}
