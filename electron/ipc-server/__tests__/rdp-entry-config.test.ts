import { describe, it, expect } from 'vitest';
import {
  buildRdpEngineConfigFromEntry,
  resolutionToDimensions,
  mapQualityToPerformanceMode,
} from '../rdp-entry-config.js';

describe('mapQualityToPerformanceMode', () => {
  it('maps quality presets to engine performance modes', () => {
    expect(mapQualityToPerformanceMode('best')).toBe('best');
    expect(mapQualityToPerformanceMode('good')).toBe('balanced');
    expect(mapQualityToPerformanceMode('low')).toBe('fast');
  });

  it('defaults to balanced when unset', () => {
    expect(mapQualityToPerformanceMode(undefined)).toBe('balanced');
  });
});

describe('resolutionToDimensions', () => {
  it('parses a fixed WxH resolution', () => {
    expect(resolutionToDimensions({ resolution: '1280x720' })).toEqual({ width: 1280, height: 720 });
  });

  it('falls back to 1920x1080 for match_window (no DOM headlessly)', () => {
    expect(resolutionToDimensions({ resolution: 'match_window' })).toEqual({ width: 1920, height: 1080 });
  });

  it('falls back to 1920x1080 when resolution is unset', () => {
    expect(resolutionToDimensions({})).toEqual({ width: 1920, height: 1080 });
  });

  it('uses custom dimensions when resolution is "custom"', () => {
    expect(resolutionToDimensions({ resolution: 'custom', customWidth: 2560, customHeight: 1440 })).toEqual({
      width: 2560,
      height: 1440,
    });
  });

  it('falls back when custom dimensions are missing', () => {
    expect(resolutionToDimensions({ resolution: 'custom' })).toEqual({ width: 1920, height: 1080 });
  });

  it('ignores a malformed resolution string', () => {
    expect(resolutionToDimensions({ resolution: 'banana' })).toEqual({ width: 1920, height: 1080 });
    expect(resolutionToDimensions({ resolution: 'x' })).toEqual({ width: 1920, height: 1080 });
  });
});

describe('buildRdpEngineConfigFromEntry', () => {
  const base = {
    host: 'server.example.com',
    port: 3389,
    username: 'admin',
    password: 'secret',
  };

  it('applies safe defaults when the entry has no stored RDP config', () => {
    const cfg = buildRdpEngineConfigFromEntry({ ...base, entryConfig: undefined });
    expect(cfg).toMatchObject({
      host: 'server.example.com',
      port: 3389,
      username: 'admin',
      password: 'secret',
      width: 1920,
      height: 1080,
      enableNla: true,
      skipCertVerification: true,
      performanceMode: 'balanced',
      enableClipboard: true,
      enableBitmapCache: true,
      enableServerPointer: true,
      frameRate: 30,
    });
    expect(cfg.sharedFolders).toBeUndefined();
  });

  it('honors stored entry settings', () => {
    const cfg = buildRdpEngineConfigFromEntry({
      ...base,
      domain: 'CORP',
      entryConfig: {
        resolution: '1440x900',
        colorDepth: 24,
        quality: 'best',
        clipboard: false,
        enableNla: false,
        hostname: 'alias.internal',
        sharedFolders: [{ name: 'Downloads', path: '/home/me/Downloads' }],
      },
    });
    expect(cfg).toMatchObject({
      domain: 'CORP',
      width: 1440,
      height: 900,
      colorDepth: 24,
      performanceMode: 'best',
      enableClipboard: false,
      enableNla: false,
      hostname: 'alias.internal',
    });
    expect(cfg.sharedFolders).toEqual([{ name: 'Downloads', path: '/home/me/Downloads' }]);
  });

  it('omits sharedFolders when the stored list is empty', () => {
    const cfg = buildRdpEngineConfigFromEntry({ ...base, entryConfig: { sharedFolders: [] } });
    expect(cfg.sharedFolders).toBeUndefined();
  });
});
