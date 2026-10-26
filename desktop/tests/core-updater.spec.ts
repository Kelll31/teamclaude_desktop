import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../src/shared/types';
import type { BackendLocation } from '../src/services/backend-runtime';
import { CoreStore, CoreUpdater, matchesIntegrity, parseManifest, type CoreChoice } from '../src/services/core-updater';
import { readTarGz, safeTarPath } from '../src/services/tar';

/** A ustar archive from [path, content, type] entries, gzipped. */
function tarGz(entries: Array<[string, string, string?]>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, content, type = '0'] of entries) {
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${Buffer.byteLength(content).toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write(type, 156);
    header.write('ustar\0', 257);
    header.write('        ', 148);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header);
    const body = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512);
    body.write(content);
    blocks.push(body);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const integrity = (data: Buffer) => `sha512-${createHash('sha512').update(data).digest('base64')}`;
const TARBALL = (v: string) => `https://registry.npmjs.org/@karpeleslab/teamclaude/-/teamclaude-${v}.tgz`;

function release(version: string): Buffer {
  return tarGz([
    ['package/package.json', JSON.stringify({ name: '@karpeleslab/teamclaude', version, type: 'module' })],
    ['package/src/index.js', 'console.log("hi")'],
    ['package/LICENSE', 'MIT'],
    ['package/README.md', 'not copied'],
  ]);
}

describe('tar reader', () => {
  it('reads regular files and refuses links and escaping paths', () => {
    expect(readTarGz(tarGz([['package/a.txt', 'A']]))).toEqual([{ path: 'package/a.txt', data: Buffer.from('A') }]);
    expect(() => readTarGz(tarGz([['package/../../evil', 'x']]))).toThrow(/unsafe path/);
    expect(() => readTarGz(tarGz([['package/link', '', '2']]))).toThrow(/entry type/);
    expect(safeTarPath('/etc/passwd')).toBeNull();
    expect(safeTarPath('C:/x')).toBeNull();
    expect(safeTarPath('a/./b')).toBe('a/b');
  });
});

describe('parseManifest', () => {
  const good = { name: '@karpeleslab/teamclaude', version: '1.2.3', dist: { tarball: TARBALL('1.2.3'), integrity: 'sha512-abc' } };

  it('accepts the registry shape', () => {
    expect(parseManifest(good)).toEqual({ version: '1.2.3', tarball: TARBALL('1.2.3'), integrity: 'sha512-abc' });
  });

  it('refuses another package, another host, or a missing checksum', () => {
    expect(() => parseManifest({ ...good, name: 'evil' })).toThrow();
    expect(() => parseManifest({ ...good, dist: { ...good.dist, tarball: 'https://evil.example/x.tgz' } })).toThrow(/tarball/);
    expect(() => parseManifest({ ...good, dist: { tarball: TARBALL('1.2.3'), integrity: 'sha1-x' } })).toThrow(/sha512/);
    expect(() => parseManifest({ ...good, version: '1.2.3-beta' })).toThrow();
  });

  it('checks integrity', () => {
    const data = Buffer.from('payload');
    expect(matchesIntegrity(data, integrity(data))).toBe(true);
    expect(matchesIntegrity(Buffer.from('other'), integrity(data))).toBe(false);
  });
});

describe('CoreUpdater', () => {
  let dir: string;
  const bundled: CoreChoice = { location: { root: '/app/backend', entry: '/app/backend/src/index.js', source: 'bundled' }, version: '1.1.25', source: 'bundled' };
  const noTimers = { setTimeout: () => 0, setInterval: () => 0, clear: () => {} };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tc-core-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function make(opts: { latest: string; auto?: boolean; activate?: (l: BackendLocation) => Promise<ActionResult>; tarball?: Buffer; printed?: string }) {
    const tarball = opts.tarball ?? release(opts.latest);
    const store = new CoreStore(join(dir, 'core'));
    const activate = vi.fn(opts.activate ?? (async () => ({ ok: true, message: '' })));
    const updater = new CoreUpdater({
      store,
      initial: bundled,
      bundled,
      minVersion: '1.1.0',
      auto: () => opts.auto ?? true,
      activate,
      smokeTest: async () => `${opts.printed ?? opts.latest}\n`,
      getJson: async () => ({ name: '@karpeleslab/teamclaude', version: opts.latest, dist: { tarball: TARBALL(opts.latest), integrity: integrity(release(opts.latest)) } }),
      download: async () => tarball,
      timers: noTimers,
    });
    return { updater, store, activate };
  }

  it('installs a newer release automatically and switches to it', async () => {
    const { updater, store, activate } = make({ latest: '1.1.26' });
    const installed = vi.fn();
    updater.on('installed', installed);
    const state = await updater.check();
    expect(state).toMatchObject({ phase: 'up-to-date', active: '1.1.26', source: 'downloaded' });
    expect(installed).toHaveBeenCalledWith('1.1.26');
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ root: join(dir, 'core', '1.1.26') }));
    expect(readFileSync(join(dir, 'core', '1.1.26', 'src', 'index.js'), 'utf8')).toContain('hi');
    expect(existsSync(join(dir, 'core', '1.1.26', 'README.md'))).toBe(false);
    expect(store.read().active).toBe('1.1.26');
    expect(store.usable('1.1.25')?.version).toBe('1.1.26');
    // An app update that bundles the same or a newer core wins.
    expect(store.usable('1.1.26')).toBeNull();
  });

  it('only reports a release when automatic updates are off, and installs on request', async () => {
    const { updater, activate } = make({ latest: '1.1.26', auto: false });
    expect((await updater.check()).phase).toBe('available');
    expect(activate).not.toHaveBeenCalled();
    expect((await updater.install()).active).toBe('1.1.26');
  });

  it('says up to date when nothing newer is out', async () => {
    const { updater, activate } = make({ latest: '1.1.25' });
    expect((await updater.check()).phase).toBe('up-to-date');
    expect(activate).not.toHaveBeenCalled();
  });

  it('refuses a download that does not match the checksum', async () => {
    const { updater, activate, store } = make({ latest: '1.1.26', tarball: release('9.9.9') });
    const state = await updater.check();
    expect(state.phase).toBe('error');
    expect(state.error).toMatch(/checksum/);
    expect(activate).not.toHaveBeenCalled();
    expect(store.read().active).toBeNull();
  });

  it('refuses a core whose test run prints something else', async () => {
    const { updater, activate } = make({ latest: '1.1.26', printed: 'Error: boom' });
    expect((await updater.check()).error).toMatch(/test run/);
    expect(activate).not.toHaveBeenCalled();
  });

  it('rolls back when the new core does not come up, and does not retry it automatically', async () => {
    const activate = vi.fn(async (l: BackendLocation) => (l.root.endsWith('1.1.26') ? { ok: false, message: 'did not answer' } : { ok: true, message: '' }));
    const { updater, store } = make({ latest: '1.1.26', activate });
    const state = await updater.check();
    expect(state).toMatchObject({ phase: 'error', active: '1.1.25', rolledBack: { version: '1.1.26', previous: '1.1.25' } });
    expect(activate).toHaveBeenLastCalledWith(bundled.location);
    expect(store.read()).toEqual({ active: null, rejected: ['1.1.26'] });
    activate.mockClear();
    expect((await updater.check()).phase).toBe('available');
    expect(activate).not.toHaveBeenCalled();
  });

  it('reverts to the bundled core', async () => {
    const { updater, store, activate } = make({ latest: '1.1.26' });
    await updater.check();
    const result = await updater.revert();
    expect(result).toMatchObject({ ok: true, version: '1.1.25' });
    expect(activate).toHaveBeenLastCalledWith(bundled.location);
    expect(updater.getState()).toMatchObject({ active: '1.1.25', source: 'bundled' });
    expect(store.read().active).toBeNull();
    expect(existsSync(join(dir, 'core', '1.1.26'))).toBe(false);
  });

  it('does nothing in a development run', async () => {
    const getJson = vi.fn();
    const updater = new CoreUpdater({
      store: new CoreStore(join(dir, 'core')),
      initial: { ...bundled, source: 'checkout' },
      bundled: { ...bundled, source: 'checkout' },
      minVersion: '1.1.0',
      auto: () => true,
      activate: async () => ({ ok: true, message: '' }),
      smokeTest: async () => '',
      getJson,
      timers: noTimers,
    });
    expect((await updater.check()).unsupported).toBe('development');
    expect(getJson).not.toHaveBeenCalled();
  });
});
