import { Download, ExternalLink, FolderOpen } from 'lucide-react';
import type { DesktopSettings, NotificationPrefs } from '../../shared/types';
import { call } from '../api';
import { ActionButton, Button, Card, Field, inputClass, PageHeader, Rich, Toggle } from '../components/ui';
import { LANGUAGES, t, type MessageKey } from '../i18n';
import { useStore } from '../store';

const NOTIFICATIONS: Array<keyof NotificationPrefs> = [
  'proxyCrashed', 'authExpired', 'allUnavailable', 'quotaExhausted', 'backendRecovered', 'updateAvailable', 'appUpdateReady', 'coreUpdated',
];

export function Settings() {
  const { settings, backend, run, setPage, toast } = useStore();
  if (!settings) return null;
  const update = (patch: Partial<DesktopSettings>) => {
    call('settings.update', patch).catch((err: Error) => toast(false, err.message));
  };
  const linux = navigator.userAgent.includes('Linux');

  return (
    <div className="space-y-4">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4">
        <Card title={t('settings.general')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settings.theme')}>
              <select className={inputClass} value={settings.theme} onChange={e => update({ theme: e.target.value as DesktopSettings['theme'] })}>
                <option value="dark">{t('settings.dark')}</option>
                <option value="light">{t('settings.light')}</option>
                <option value="system">{t('settings.system')}</option>
              </select>
            </Field>
            <Field label={t('settings.language')}>
              {/* Each language is named in itself, so it can be found from any current language. */}
              <select className={inputClass} value={settings.language} onChange={e => update({ language: e.target.value })}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-2 divide-y divide-border">
            <Toggle label={t('settings.launchAtLogin')} checked={settings.launchAtLogin} onChange={v => update({ launchAtLogin: v })}
              description={t(linux ? 'settings.launchLinux' : 'settings.launchWindows')} />
            <Toggle label={t('settings.startMinimized')} checked={settings.startMinimized} onChange={v => update({ startMinimized: v })} description={t('settings.startMinimizedDesc')} />
            <Toggle label={t('settings.minimizeToTray')} checked={settings.minimizeToTray} onChange={v => update({ minimizeToTray: v })} />
          </div>
        </Card>
        <Card title={t('settings.proxy')}>
          <dl className="mb-2 grid grid-cols-2 gap-2 text-[13px]">
            <div><dt className="text-[11px] uppercase tracking-wider text-muted">{t('settings.address')}</dt><dd className="font-mono text-[12px]">{backend?.host}:{backend?.port}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wider text-muted">{t('settings.backend')}</dt><dd>{backend?.status?.server.version ?? t('common.notRunning')}</dd></div>
          </dl>
          <p className="mb-2 text-[11px] text-muted"><Rich text={t('settings.hostNote')} /></p>
          <div className="divide-y divide-border">
            <Toggle label={t('settings.startOnLaunch')} checked={settings.startProxyOnLaunch} onChange={v => update({ startProxyOnLaunch: v })} description={t('settings.startOnLaunchDesc')} />
            <Toggle label={t('settings.keepRunning')} checked={settings.keepProxyOnWindowClose} onChange={v => update({ keepProxyOnWindowClose: v })} description={t('settings.keepRunningDesc')} />
            <Toggle label={t('settings.restartOnCrash')} checked={settings.restartOnCrash} onChange={v => update({ restartOnCrash: v })} description={t('settings.restartOnCrashDesc')} />
          </div>
        </Card>
        <Card title={t('settings.updates')}>
          <div className="divide-y divide-border">
            <Toggle label={t('settings.autoUpdate')} checked={settings.autoUpdate} onChange={v => update({ autoUpdate: v })} description={t('settings.autoUpdateDesc')} />
            <Toggle label={t('settings.autoUpdateCore')} checked={settings.autoUpdateCore} onChange={v => update({ autoUpdateCore: v })} description={t('settings.autoUpdateCoreDesc')} />
          </div>
          <Button className="mt-2" variant="ghost" onClick={() => setPage('about')}>{t('about.appTitle')}</Button>
        </Card>
        <Card title={t('settings.notifications')}>
          <div className="divide-y divide-border">
            {NOTIFICATIONS.map(key => (
              <Toggle key={key} label={t(`notify.${key}` as MessageKey)} checked={settings.notifications[key]} onChange={v => update({ notifications: { ...settings.notifications, [key]: v } })} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">{t('settings.notifyNote')}</p>
        </Card>
        <Card title={t('settings.routing')}>
          <p className="text-[13px] text-muted">{t('settings.routingBody')}</p>
          <Button className="mt-3" onClick={() => setPage('routing')}>{t('settings.openRouting')}</Button>
        </Card>
        <Card title={t('settings.advanced')}>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={<FolderOpen className="size-3.5" aria-hidden />} onAction={() => run(() => call('system.openConfigDir'))}>{t('settings.openConfig')}</ActionButton>
            <ActionButton icon={<Download className="size-3.5" aria-hidden />} onAction={() => run(() => call('system.exportDiagnostics'))}>{t('settings.export')}</ActionButton>
            <ActionButton icon={<ExternalLink className="size-3.5" aria-hidden />} disabled={backend?.phase !== 'running'} onAction={() => run(() => call('system.openDashboard'))}>{t('settings.openDashboard')}</ActionButton>
          </div>
          <p className="mt-2 text-[11px] text-muted">{t('settings.diagNote')}</p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.configFile')} <span className="break-all font-mono">{backend?.configPath}</span></p>
        </Card>
      </div>
    </div>
  );
}
