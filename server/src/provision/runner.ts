import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Roda o dev server do frontend provisionado, a pedido da UI (quando o usuário
 * liga o preview pela 1ª vez após o upload). Detecta o gerenciador de pacotes,
 * instala se preciso e sobe `dev`, reportando o estado para a UI mostrar o
 * "carregando" até o sistema responder.
 *
 * Só roda em dev e só dentro da pasta-pai da app (o controller valida o caminho).
 * O processo filho é morto quando a Strapi encerra.
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
    return res.status < 500;
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

export function startFrontend(_strapi: any, opts: { dir: string; url: string }): RunInfo {
  const { dir, url } = opts;

  // idempotente: já rodando/subindo para o mesmo dir
  if (child && info.dir === dir && ['installing', 'starting', 'running'].includes(info.state)) {
    return getRunStatus();
  }
  // troca de projeto: encerra o anterior
  stopFrontend();

  const pm = detectPM(dir);
  info = { state: 'installing', dir, url, pm, error: null, log: [] };

  const spawnIn = (cmd: string, args: string[]) =>
    spawn(cmd, args, { cwd: dir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

  const startDev = () => {
    info.state = 'starting';
    const devArgs = pm === 'yarn' ? ['dev'] : ['run', 'dev'];
    child = spawnIn(pm, devArgs);
    child.stdout?.on('data', (d) => pushLog(d));
    child.stderr?.on('data', (d) => pushLog(d));
    child.on('exit', (code) => {
      if (info.state !== 'running') {
        info.state = 'error';
        info.error = `dev encerrou (código ${code}). Veja o log.`;
      }
    });
    // confirma que subiu fazendo polling no próprio URL
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
