// What each IPC method does. Every privileged effect the renderer can cause is
// listed here; arguments have already been validated by main/ipc.ts.

import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname } from 'node:path';
import { clipboard, dialog, shell, type BrowserWindow } from 'electron';
import type { ActivityLog } from '../shared/activity';
import type { Translate } from '../shared/i18n';
import type { ActionResult, DesktopSettings, IdeId, SystemInfo } from '../shared/types';
import type { BackendManager } from '../services/backend-manager';
import { crashLogPath } from '../services/backend-config';
import type { ControlResult } from '../services/backend-client';
import type { CoreUpdater } from '../services/core-updater';
import { applyIde, listIdeTargets, proxyUrl } from '../services/ide-connect';
import { RELEASES_URL, type AppUpdater } from '../services/app-updater';
import { buildDiagnosticReport } from '../services/diagnostics';
import { readFileTail } from '../services/file-tail';
import { envSnippets, findExecutable, terminalCommand, toolInfo, vscodeSnippet } from '../services/integrations';
import {
  apiKeyArgs, distributeArgs, importArgs, intervalArgs, loginArgs, removeArgs, renameArgs, type JobRunner,
} from '../services/job-runner';
import type { LogBuffer } from '../services/log-buffer';
import { describeError, sanitizeText } from '../services/sanitize';
import type { SettingsStore } from '../services/settings-store';
import { checkForUpdates } from '../services/update-check';
import type { Handlers } from './ipc';

const LINKS = {
  repository: 'https://github.com/KarpelesLab/teamclaude',
  issues: 'https://github.com/KarpelesLab/teamclaude/issues',
  docs: 'https://github.com/KarpelesLab/teamclaude/blob/master/docs/desktop.md',
  releases: 'https://github.com/KarpelesLab/teamclaude/releases',
  license: 'https://github.com/KarpelesLab/teamclaude/blob/master/LICENSE',
  desktopReleases: RELEASES_URL,
} as const;

const CRASH_LOG_TAIL_BYTES = 64 * 1024;

export interface HandlerContext {
  manager: BackendManager;
  jobs: JobRunner;
  logs: LogBuffer;
  history: ActivityLog;
  appUpdater: AppUpdater;
  coreUpdater: CoreUpdater;
  settings: SettingsStore;
  applySettings: (next: DesktopSettings, previous: DesktopSettings) => void;
  window: () => BrowserWindow | null;
  t: () => Translate;
  desktopVersion: string;
  bundledBackendVersion: string | null;
  userDataDir: string;
}

function changeIde(ctx: HandlerContext, id: IdeId, connect: boolean): ActionResult {
  const t = ctx.t();
  const { port } = ctx.manager.getState();
  const target = listIdeTargets(port).find(target => target.id === id);
  if (!target || (!target.installed && connect)) return { ok: false, message: t('h.ideUnknown') };
  const name = id === 'claude' ? t('int.ideClaudeName') : target.name;
  try {
    applyIde(target, connect ? proxyUrl(port) : null);
  } catch (err) {
    return { ok: false, message: t('h.ideFailed', { name, error: describeError(err) }) };
  }
  ctx.logs.note(`${connect ? 'Connected' : 'Disconnected'} ${target.name} (${target.settingsPath}).`);
  return { ok: true, message: t(connect ? 'h.ideConnected' : 'h.ideDisconnected', { name }) };
}

export function systemInfo(ctx: HandlerContext): SystemInfo {
  const state = ctx.manager.getState();
  return {
    os: `${platform()} ${release()}`,
    arch: arch(),
    desktopVersion: ctx.desktopVersion,
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node,
    backendVersion: state.status?.server.version ?? null,
    bundledBackendVersion: ctx.bundledBackendVersion,
    proxyPhase: state.phase,
    lastError: state.lastError,
    configDir: dirname(state.configPath),
    userDataDir: ctx.userDataDir,
  };
}

export function openDashboard(ctx: HandlerContext): ActionResult {
  const state = ctx.manager.getState();
  const t = ctx.t();
  if (state.phase !== 'running') return { ok: false, message: t('h.notRunning') };
  void shell.openExternal(`${state.endpoint}/teamclaude/dashboard`);
  return { ok: true, message: t('h.dashboard') };
}

export function createHandlers(ctx: HandlerContext): Handlers {
  const { manager, jobs, logs } = ctx;
  const t: Translate = (key, vars) => ctx.t()(key, vars);
  const fromControl = (result: ControlResult, success: string): ActionResult =>
    result.ok ? { ok: true, message: success } : { ok: false, message: result.error ?? t('h.requestFailed') };

  return {
    'backend.getState': () => manager.getState(),
    'backend.start': () => manager.start(),
    'backend.stop': () => manager.stop(),
    'backend.restart': () => manager.restart(),
    'backend.refresh': () => manager.refresh(),
    'backend.reload': async () => {
      const r = await manager.control('/teamclaude/reload');
      return fromControl(r, t('h.reloaded', { added: Number(r.body?.added ?? 0), removed: Number(r.body?.removed ?? 0) }));
    },
    'backend.probe': async () => fromControl(await manager.control('/teamclaude/probe'), t('h.probed')),

    'accounts.switch': async ({ account }) => {
      const r = await manager.control('/teamclaude/switch', { account });
      if (!r.ok) return { ok: false, message: r.error ?? t('h.switchFailed') };
      const eligible = r.body?.eligible !== false;
      const reason = typeof r.body?.reason === 'string' ? r.body.reason : t('h.unavailable');
      return { ok: true, message: eligible ? t('h.prefer', { name: account }) : t('h.preferIneligible', { name: account, reason }) };
    },
    'accounts.setDisabled': async ({ account, disabled }) =>
      fromControl(await manager.control('/teamclaude/disable', { account, disabled }), t(disabled ? 'h.disabled' : 'h.enabled', { name: account })),
    'accounts.setPriority': async ({ account, priority }) =>
      fromControl(await manager.control('/teamclaude/priority', { account, priority }), t('h.priority', { name: account, priority })),
    'accounts.login': ({ provider, name }) => {
      const label = name
        ? t('j.loginNamed', { name, provider: provider === 'codex' ? 'Codex' : 'Claude' })
        : t(provider === 'codex' ? 'j.loginCodex' : 'j.loginClaude');
      return jobs.run('login', label, loginArgs(provider, name));
    },
    'accounts.addApiKey': ({ name, apiKey, priority }) =>
      jobs.run('apikey', name ? t('j.apikeyNamed', { name }) : t('j.apikey'), apiKeyArgs(name, priority), apiKey),
    'accounts.import': ({ name }) => jobs.run('import', t('j.import'), importArgs(name)),
    'accounts.remove': ({ account }) => jobs.run('remove', t('j.remove', { name: account }), removeArgs(account)),
    'accounts.rename': ({ account, newName }) => jobs.run('rename', t('j.rename', { from: account, to: newName }), renameArgs(account, newName)),

    'routing.setThreshold': async ({ percent }) =>
      fromControl(await manager.control('/teamclaude/threshold', { percent }), t('h.threshold', { percent })),
    'routing.setDistribution': ({ mode }) => jobs.run('distribute', t('j.distribute', { mode }), distributeArgs(mode)),
    'routing.setProbe': ({ seconds }) => jobs.run('probe', seconds ? t('j.probeOn', { s: seconds }) : t('j.probeOff'), intervalArgs('probe', seconds)),
    'routing.setWarmup': ({ seconds }) => jobs.run('warmup', seconds ? t('j.warmOn', { s: seconds }) : t('j.warmOff'), intervalArgs('warmup', seconds)),

    'jobs.list': () => jobs.list(),
    'jobs.cancel': ({ id }) => (jobs.cancel(id) ? { ok: true, message: t('h.cancelled') } : { ok: false, message: t('h.jobNotRunning') }),

    'logs.get': () => logs.all(),
    'logs.clear': () => { logs.clear(); return { ok: true, message: t('h.cleared') }; },
    'logs.readCrashLog': () => {
      const text = readFileTail(crashLogPath(manager.getState().configPath), CRASH_LOG_TAIL_BYTES);
      return text === null ? null : sanitizeText(text);
    },

    'history.get': () => ctx.history.history(),

    'settings.get': () => ctx.settings.get(),
    'settings.update': patch => {
      const previous = ctx.settings.get();
      const next = ctx.settings.update(patch);
      ctx.applySettings(next, previous);
      return next;
    },

    'system.info': () => systemInfo(ctx),
    'system.integrations': () => {
      const state = manager.getState();
      const claude = toolInfo('claude');
      return {
        endpoint: state.endpoint,
        proxyReady: state.phase === 'running',
        claude,
        codex: toolInfo('codex'),
        env: envSnippets(state.port),
        vscodeSettingsSnippet: vscodeSnippet(state.port),
        ides: listIdeTargets(state.port, { claudeFound: claude.found }),
      };
    },
    'system.openDashboard': () => openDashboard(ctx),
    'system.openConfigDir': async () => {
      const dir = dirname(manager.getState().configPath);
      if (!existsSync(dir)) return { ok: false, message: t('h.noConfigDir') };
      const error = await shell.openPath(dir);
      return error ? { ok: false, message: error } : { ok: true, message: t('h.configDir') };
    },
    'system.openExternal': ({ target }) => {
      void shell.openExternal(LINKS[target]);
      return { ok: true, message: t('h.opened') };
    },
    'system.copyText': ({ text }) => {
      clipboard.writeText(sanitizeText(text));
      return { ok: true, message: t('h.copied') };
    },
    'system.exportDiagnostics': async () => {
      const win = ctx.window();
      const options = {
        title: t('h.saveTitle'),
        defaultPath: `teamclaude-diagnostics-${new Date().toISOString().slice(0, 10)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      };
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { ok: false, message: t('h.cancelled') };
      try {
        writeFileSync(choice.filePath, buildDiagnosticReport(systemInfo(ctx), manager.getState(), logs.all()), { mode: 0o600 });
        return { ok: true, message: t('h.saved', { path: choice.filePath }) };
      } catch (err) {
        return { ok: false, message: t('h.saveFailed', { error: describeError(err) }) };
      }
    },
    'system.checkForUpdates': () => {
      const state = manager.getState();
      const external = state.ownership === 'external' ? state.status?.server.version ?? null : null;
      return checkForUpdates({ bundled: ctx.coreUpdater.getState().active ?? ctx.bundledBackendVersion, external });
    },
    'coreUpdate.getState': () => ctx.coreUpdater.getState(),
    'coreUpdate.check': () => ctx.coreUpdater.check(),
    'coreUpdate.install': () => ctx.coreUpdater.install(),
    'coreUpdate.revert': async () => {
      const result = await ctx.coreUpdater.revert();
      if (!result.ok && !result.message) return { ok: false, message: t('h.coreNothingToRevert') };
      return result.ok ? { ok: true, message: t('h.coreReverted', { version: result.version ?? '' }) } : result;
    },
    'ide.connect': ({ id }) => changeIde(ctx, id, true),
    'ide.disconnect': ({ id }) => changeIde(ctx, id, false),
    'appUpdate.getState': () => ctx.appUpdater.getState(),
    'appUpdate.check': () => ctx.appUpdater.check(),
    'appUpdate.download': () => ctx.appUpdater.download(),
    'appUpdate.install': () =>
      ctx.appUpdater.install() ? { ok: true, message: t('h.installing') } : { ok: false, message: t('h.noUpdateReady') },

    'system.openTerminal': () => {
      const state = manager.getState();
      const term = terminalCommand(process.platform, process.env, name => findExecutable(name));
      if (!term) return { ok: false, message: t('h.noTerminal') };
      const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_BASE_URL: `http://localhost:${state.port}` };
      delete env.ELECTRON_RUN_AS_NODE;
      try {
        const child = spawn(term.command, term.args, { env, detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', err => logs.note(t('h.terminalFailed', { error: describeError(err) })));
        child.unref();
        return { ok: true, message: t('h.terminal') };
      } catch (err) {
        return { ok: false, message: t('h.terminalFailed', { error: describeError(err) }) };
      }
    },
  };
}
