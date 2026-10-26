// Validation of every IPC call before it reaches a handler. The renderer is
// treated as untrusted input: unknown methods are refused, objects must carry
// exactly the expected keys, and every value is range- and shape-checked.

import { isLanguage } from '../shared/i18n';
import type { MethodName } from '../shared/ipc';
import type { DesktopSettings, DistributionMode, IdeId, NotificationPrefs, Theme } from '../shared/types';

export type Validation<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
type Validator = (args: unknown) => Validation;

const DISTRIBUTION_MODES: readonly DistributionMode[] = ['on', 'off', 'adaptive', 'load'];

const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
const fail = (error: string): Validation<never> => ({ ok: false, error });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): string | null {
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) return `unexpected field "${key}"`;
  }
  for (const key of required) if (!(key in value)) return `missing field "${key}"`;
  return null;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * An account name or alias as the CLI takes it: non-empty, bounded, no
 * control characters, and not starting with "-" so it can never be read as a
 * flag by the CLI's argument parser.
 */
export function isAccountName(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 200
    && !CONTROL.test(value)
    && !value.trimStart().startsWith('-');
}

export function isApiKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 512 && !/\s/.test(value) && !CONTROL.test(value);
}

function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

const none: Validator = args => (args === undefined || args === null ? ok(undefined) : fail('this method takes no arguments'));

function object(required: string[], optional: string[], check: (v: Record<string, unknown>) => string | null): Validator {
  return args => {
    if (!isPlainObject(args)) return fail('arguments must be an object');
    const shape = exactKeys(args, required, optional);
    if (shape) return fail(shape);
    const problem = check(args);
    return problem ? fail(problem) : ok(args);
  };
}

const optionalName = (v: Record<string, unknown>): string | null =>
  v.name === undefined || isAccountName(v.name) ? null : 'invalid account name';

const IDE_IDS: IdeId[] = ['claude', 'vscode', 'vscode-insiders', 'cursor', 'windsurf', 'vscodium'];
const THEMES: Theme[] = ['dark', 'light', 'system'];
const NOTIFICATION_KEYS: Array<keyof NotificationPrefs> = [
  'proxyCrashed', 'authExpired', 'allUnavailable', 'quotaExhausted', 'backendRecovered', 'updateAvailable', 'appUpdateReady', 'coreUpdated',
];
const BOOLEAN_SETTINGS: Array<keyof DesktopSettings> = [
  'launchAtLogin', 'startProxyOnLaunch', 'startMinimized', 'minimizeToTray', 'keepProxyOnWindowClose', 'restartOnCrash', 'autoUpdate', 'autoUpdateCore',
];

export const validateSettingsPatch: Validator = args => {
  if (!isPlainObject(args)) return fail('settings must be an object');
  for (const [key, value] of Object.entries(args)) {
    if (key === 'theme') {
      if (!THEMES.includes(value as Theme)) return fail('invalid theme');
    } else if (key === 'language') {
      if (!isLanguage(value)) return fail('invalid language');
    } else if ((BOOLEAN_SETTINGS as string[]).includes(key)) {
      if (typeof value !== 'boolean') return fail(`${key} must be true or false`);
    } else if (key === 'notifications') {
      if (!isPlainObject(value)) return fail('notifications must be an object');
      for (const [n, flag] of Object.entries(value)) {
        if (!(NOTIFICATION_KEYS as string[]).includes(n)) return fail(`unknown notification "${n}"`);
        if (typeof flag !== 'boolean') return fail(`${n} must be true or false`);
      }
    } else {
      return fail(`unknown setting "${key}"`);
    }
  }
  return ok(args);
};

export const VALIDATORS: Record<MethodName, Validator> = {
  'backend.getState': none,
  'backend.start': none,
  'backend.stop': none,
  'backend.restart': none,
  'backend.refresh': none,
  'backend.reload': none,
  'backend.probe': none,

  'accounts.switch': object(['account'], [], v => (isAccountName(v.account) ? null : 'invalid account')),
  'accounts.setDisabled': object(['account', 'disabled'], [], v =>
    !isAccountName(v.account) ? 'invalid account' : typeof v.disabled !== 'boolean' ? 'disabled must be true or false' : null),
  'accounts.setPriority': object(['account', 'priority'], [], v =>
    !isAccountName(v.account) ? 'invalid account' : !intIn(v.priority, -1000, 1000) ? 'priority must be an integer from -1000 to 1000' : null),
  'accounts.login': object(['provider'], ['name'], v =>
    v.provider !== 'claude' && v.provider !== 'codex' ? 'provider must be "claude" or "codex"' : optionalName(v)),
  'accounts.addApiKey': object(['apiKey'], ['name', 'priority'], v =>
    !isApiKey(v.apiKey) ? 'that does not look like an API key'
      : v.priority !== undefined && !intIn(v.priority, -1000, 1000) ? 'priority must be an integer from -1000 to 1000'
        : optionalName(v)),
  'accounts.import': object([], ['name'], optionalName),
  'accounts.remove': object(['account'], [], v => (isAccountName(v.account) ? null : 'invalid account')),
  'accounts.rename': object(['account', 'newName'], [], v =>
    !isAccountName(v.account) ? 'invalid account' : !isAccountName(v.newName) ? 'invalid new name' : null),

  'routing.setThreshold': object(['percent'], [], v =>
    typeof v.percent === 'number' && Number.isFinite(v.percent) && v.percent >= 1 && v.percent <= 100 ? null : 'percent must be from 1 to 100'),
  'routing.setDistribution': object(['mode'], [], v =>
    DISTRIBUTION_MODES.includes(v.mode as DistributionMode) ? null : 'mode must be on, off, adaptive or load'),
  'routing.setProbe': object(['seconds'], [], v => (intIn(v.seconds, 0, 86_400) && (v.seconds === 0 || v.seconds >= 30) ? null : 'seconds must be 0 (off) or 30–86400')),
  'routing.setWarmup': object(['seconds'], [], v => (intIn(v.seconds, 0, 86_400) && (v.seconds === 0 || v.seconds >= 60) ? null : 'seconds must be 0 (off) or 60–86400')),

  'jobs.list': none,
  'jobs.cancel': object(['id'], [], v => (intIn(v.id, 1, Number.MAX_SAFE_INTEGER) ? null : 'invalid job id')),

  'logs.get': none,
  'logs.clear': none,
  'logs.readCrashLog': none,

  'history.get': none,

  'settings.get': none,
  'settings.update': validateSettingsPatch,

  'system.info': none,
  'system.integrations': none,
  'system.openDashboard': none,
  'system.openConfigDir': none,
  'system.openExternal': object(['target'], [], v =>
    ['repository', 'issues', 'docs', 'releases', 'license', 'desktopReleases'].includes(v.target as string) ? null : 'unknown link'),
  'system.copyText': object(['text'], [], v => (typeof v.text === 'string' && v.text.length <= 200_000 ? null : 'invalid text')),
  'system.exportDiagnostics': none,
  'system.checkForUpdates': none,
  'system.openTerminal': none,

  'appUpdate.getState': none,
  'appUpdate.check': none,
  'appUpdate.download': none,
  'appUpdate.install': none,

  'coreUpdate.getState': none,
  'coreUpdate.check': none,
  'coreUpdate.install': none,
  'coreUpdate.revert': none,

  'ide.connect': object(['id'], [], v => (IDE_IDS.includes(v.id as IdeId) ? null : 'unknown editor')),
  'ide.disconnect': object(['id'], [], v => (IDE_IDS.includes(v.id as IdeId) ? null : 'unknown editor')),
};

export function isMethodName(value: unknown): value is MethodName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VALIDATORS, value);
}

export function validateCall(method: unknown, args: unknown): { ok: true; method: MethodName; args: unknown } | { ok: false; error: string } {
  if (!isMethodName(method)) return { ok: false, error: 'unknown method' };
  const result = VALIDATORS[method](args);
  return result.ok ? { ok: true, method, args: result.value } : { ok: false, error: `${method}: ${result.error}` };
}
