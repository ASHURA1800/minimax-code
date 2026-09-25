import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getTuiDataDirPath,
  prepareTuiDataDir,
  resolveDefaultTuiDataDir,
} from '../../src/runtime/data-dir.js';

describe('TUI data directory', () => {
  it.each(['dev', 'test', 'staging', 'prod'] as const)(
    'uses the shared user directory for %s builds',
    (buildEnv) => {
      if (process.platform === 'linux') {
        const xdgHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
        expect(resolveDefaultTuiDataDir(buildEnv, undefined, () => null)).toBe(
          join(xdgHome, 'minimax'),
        );
      } else {
        expect(resolveDefaultTuiDataDir(buildEnv, undefined, () => null)).toBe(
          join(homedir(), '.minimax'),
        );
      }
    },
  );

  it('keeps the shared profile suffix', () => {
    if (process.platform === 'linux') {
      const xdgHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
      expect(resolveDefaultTuiDataDir('prod', undefined, () => 'smoke')).toBe(
        join(xdgHome, 'minimax-smoke'),
      );
    } else {
      expect(resolveDefaultTuiDataDir('prod', undefined, () => 'smoke')).toBe(
        join(homedir(), '.minimax-smoke'),
      );
    }
  });

  it.each([
    [{}, '/default'],
    [{ MINIMAX_DATA_DIR: '  ', MAVIS_DATA_DIR: ' ' }, '/default'],
    [{ MINIMAX_DATA_DIR: ' /public ', MAVIS_DATA_DIR: '/legacy' }, '/public'],
    [{ MINIMAX_DATA_DIR: ' ', MAVIS_DATA_DIR: ' /legacy ' }, '/legacy'],
  ])('preserves override precedence for %j', (environment, expected) => {
    expect(getTuiDataDirPath(environment, () => '/default')).toBe(expected);
  });

  it('passes the selected directory to runtime initialization', async () => {
    const configureRuntimeEnvironment = vi.fn();
    await expect(prepareTuiDataDir({
      environment: { MINIMAX_DATA_DIR: ' /selected ' },
      getBuildEnv: () => 'prod',
      configureRuntimeEnvironment,
    })).resolves.toBe('/selected');
    expect(configureRuntimeEnvironment).toHaveBeenCalledWith({ dataDir: '/selected' });
  });
});
