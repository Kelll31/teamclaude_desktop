// Application lifecycle: one instance, one window, one tray icon, one
// BackendManager. Wires the services to Electron and nothing more — the logic
// lives in src/services so it can be tested without Electron.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, nativeImage, Notification, type NativeImage } from 'electron';
import { ActivityLog, isEmptyDelta } from '../shared/activity';
import { languageForLocale, translator, type Translate } from '../shared/i18n';
import { EVENT_CHANNEL, type DesktopEvent, type PageId } from '../shared/ipc';
import type { BackendState, DesktopSettings } from '../shared/types';
import { BackendClient } from '../services/backend-client';
import { readProxySettings, resolveConfigPath, serviceUnitPath } from '../services/backend-config';
import { BackendManager } from '../services/backend-manager';
import { backendSpawnSpec, readBackendVersion, resolveBackendLocation, type BackendLocation } from '../services/backend-runtime';
import { CoreStore, CoreUpdater, type CoreChoice } from '../services/core-updater';
import { AUTOSTART_ARG, setLinuxAutostart } from '../services/autostart';
import { JobRunner } from '../services/job-runner';
import { LogBuffer } from '../services/log-buffer';
import { describeError } from '../services/sanitize';
import { OwnedPidFile, SettingsStore } from '../services/settings-store';
import { createHandlers, openDashboard, type HandlerContext } from './handlers';
import { registerIpc } from './ipc';
import { Notifier } from './notifications';
import { AppTray } from './tray';
import { createAppUpdater } from './updater';
import { createMainWindow, rendererUrl } from './window';

const POLL_VISIBLE_MS = 2000;
const POLL_HIDDEN_MS = 10_000;
const MIN_BACKEND_VERSION = '1.1.0';

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let quitting = false;
let shutdownDone = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(init).catch(err => {
    console.error('TeamClaude Desktop failed to start:', describeError(err));
    app.exit(1);
  });
}

// Defence in depth for any web contents, not only the main window.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', event => event.preventDefault());
});

function send(event: DesktopEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENT_CHANNEL, event);
}

function showWindow(page?: PageId): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (page) send({ type: 'navigate', page });
}

function resourcePath(...parts: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), 'build', ...parts);
}

function loadIcon(): NativeImage | undefined {
  const path = resourcePath('icon.png');
  if (!existsSync(path)) return undefined;
  const image = nativeImage.createFromPath(path);
  return image.isEmpty() ? undefined : image;
}

function applyLoginItem(enabled: boolean): void {
  try {
    if (process.platform === 'linux') setLinuxAutostart(enabled, process.execPath);
    else app.setLoginItemSettings({ openAtLogin: enabled, args: [AUTOSTART_ARG] });
  } catch (err) {
    console.error('Could not change launch-at-login:', describeError(err));
  }
}

async function init(): Promise<void> {
  const userData = app.getPath('userData');
  // On first run the UI follows the system language when it is one we ship.
  const settings = new SettingsStore(join(userData, 'settings.json'), undefined, { language: languageForLocale(app.getLocale()) });
  const t = (): Translate => translator(settings.get().language);
  const logs = new LogBuffer();
  const bundledLocation = resolveBackendLocation({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const bundledBackendVersion = bundledLocation ? readBackendVersion(bundledLocation.root) : null;
  if (!bundledLocation) logs.note('The bundled backend was not found; only attaching to a running proxy is possible.');
  const bundledCore: CoreChoice | null = bundledLocation
    ? { location: bundledLocation, version: bundledBackendVersion, source: bundledLocation.source === 'checkout' ? 'checkout' : 'bundled' }
    : null;
  // A core downloaded from npm replaces the bundled one while it is the newer of the two.
  const coreStore = new CoreStore(join(userData, 'core'));
  const downloaded = bundledCore?.source === 'bundled' ? coreStore.usable(bundledBackendVersion) : null;
  const initialCore: CoreChoice | null = downloaded ? { ...downloaded, source: 'downloaded' } : bundledCore;
  let location: BackendLocation | null = initialCore?.location ?? null;

  const spawnAt = (at: BackendLocation, args: string[]) => {
    const spec = backendSpawnSpec(process.execPath, at, args, process.env);
    return spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  };
  const spawnBackend = (args: string[]) => (location ? spawnAt(location, args) : null);

  const manager = new BackendManager({
    configPath: () => resolveConfigPath(),
    readSettings: path => readProxySettings(path),
    createClient: (host, port, apiKey) => new BackendClient({ host, port, apiKey }),
    spawnServer: () => spawnBackend(['server', '--headless']),
    serviceInstalled: () => process.platform === 'linux' && existsSync(serviceUnitPath()),
    killPid: (pid, signal) => process.kill(pid, signal),
    ownedPid: new OwnedPidFile(join(userData, 'runtime.json')),
    log: logs,
    minBackendVersion: MIN_BACKEND_VERSION,
    restartOnCrash: () => settings.get().restartOnCrash,
    t,
  });
  const jobs = new JobRunner(spawnBackend, t);

  const icon = loadIcon();
  const notifier = new Notifier(() => settings.get().notifications, t, () => showWindow());
  const appUpdater = createAppUpdater({
    auto: () => settings.get().autoUpdate,
    prefs: () => settings.get().notifications,
    t,
    log: text => logs.note(text),
    onState: state => send({ type: 'appUpdate', state }),
    onNotificationClick: () => showWindow('about'),
  });

  const coreUpdater = new CoreUpdater({
    store: coreStore,
    initial: initialCore,
    bundled: bundledCore,
    minVersion: MIN_BACKEND_VERSION,
    auto: () => settings.get().autoUpdateCore,
    log: text => logs.note(text),
    smokeTest: at => smokeTest(spawnAt(at, ['--version'])),
    activate: async at => {
      location = at;
      const state = manager.getState();
      if (state.ownership !== 'owned' || state.phase !== 'running') return { ok: true, message: '' };
      return manager.restart();
    },
  });
  coreUpdater.on('state', state => send({ type: 'coreUpdate', state }));
  coreUpdater.on('installed', (version: string) => {
    if (!settings.get().notifications.coreUpdated || !Notification.isSupported()) return;
    const n = new Notification({ title: t()('n.coreTitle'), body: t()('n.coreBody', { version }) });
    n.on('click', () => showWindow('about'));
    n.show();
  });

  const history = new ActivityLog();
  manager.on('state', (state: BackendState) => {
    const delta = history.observe(state);
    send({ type: 'backend', state });
    if (!isEmptyDelta(delta)) send({ type: 'history', delta });
    tray?.update(state);
    notifier.handle(state);
  });
  logs.onLines(lines => send({ type: 'log', lines }));
  jobs.on('job', job => send({ type: 'job', job }));
  // The CLI notifies a running server itself; refresh so the change shows now.
  jobs.on('done', () => { void manager.refresh(); });

  const indexHtml = join(app.getAppPath(), 'out', 'renderer', 'index.html');
  const ctx: HandlerContext = {
    manager,
    jobs,
    logs,
    history,
    appUpdater,
    coreUpdater,
    settings,
    window: () => mainWindow,
    t,
    desktopVersion: app.getVersion(),
    bundledBackendVersion,
    userDataDir: userData,
    applySettings: (next: DesktopSettings, previous: DesktopSettings) => {
      if (next.launchAtLogin !== previous.launchAtLogin) applyLoginItem(next.launchAtLogin);
      if (next.autoUpdate !== previous.autoUpdate) appUpdater.applyAuto(next.autoUpdate);
      if (next.autoUpdateCore !== previous.autoUpdateCore) coreUpdater.applyAuto(next.autoUpdateCore);
      if (next.language !== previous.language) tray?.update(manager.getState());
      send({ type: 'settings', settings: next });
    },
  };
  registerIpc(createHandlers(ctx), rendererUrl(indexHtml));

  const launchedAtLogin = process.argv.includes(AUTOSTART_ARG);
  const initial = settings.get();
  mainWindow = createMainWindow({
    preload: join(__dirname, '..', 'preload', 'index.js'),
    indexHtml,
    icon,
    show: !(initial.startMinimized || launchedAtLogin),
    devTools: !app.isPackaged,
  });

  if (icon) {
    const size = process.platform === 'win32' ? 16 : 22;
    tray = AppTray.create(icon.resize({ width: size, height: size }), {
      show: page => showWindow(page),
      start: () => { void manager.start(); },
      stop: () => { void manager.stop(); },
      openDashboard: () => { openDashboard(ctx); },
      quit: () => app.quit(),
    }, t);
    tray?.update(manager.getState());
  }
  // Without a tray, a hidden window could not be brought back.
  if (!tray && !mainWindow.isVisible()) mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('minimize', () => {
    if (tray && settings.get().minimizeToTray) mainWindow?.hide();
  });
  mainWindow.on('close', event => {
    if (quitting) return;
    if (tray && settings.get().keepProxyOnWindowClose) {
      event.preventDefault();
      mainWindow?.hide();
      return;
    }
    app.quit();
  });
  mainWindow.on('show', () => manager.startPolling(POLL_VISIBLE_MS));
  mainWindow.on('hide', () => manager.startPolling(POLL_HIDDEN_MS));

  await manager.refresh();
  if (initial.startProxyOnLaunch && manager.getState().phase !== 'running') void manager.start();
  manager.startPolling(mainWindow.isVisible() ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  appUpdater.start();
  coreUpdater.start();

  app.on('before-quit', event => {
    quitting = true;
    if (shutdownDone) return;
    event.preventDefault();
    jobs.cancelAll();
    manager.shutdown({ stopOwned: true })
      .catch(err => console.error('Shutdown error:', describeError(err)))
      .finally(() => {
        shutdownDone = true;
        tray?.destroy();
        app.quit();
      });
  });
}

const SMOKE_TEST_TIMEOUT_MS = 20_000;

/** What `teamclaude --version` prints, or a rejection when it fails or hangs. */
function smokeTest(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the test run did not finish')); }, SMOKE_TEST_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => { if (out.length < 4096) out += chunk.toString('utf8'); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`the test run exited with code ${code}`));
    });
  });
}

app.on('window-all-closed', () => {
  // The window is hidden, not closed, while the tray keeps the app alive.
  if (!tray) app.quit();
});
