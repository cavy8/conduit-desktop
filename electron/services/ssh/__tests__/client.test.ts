import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Regression tests for SshSession auth wiring.
 *
 * The bug: servers like VMware ESXi advertise only `keyboard-interactive`
 * (not the plain `password` method). ssh2 must be told to fall back to
 * keyboard-interactive via `tryKeyboard` and answer the prompts with the
 * password, otherwise password auth fails with
 * "All configured authentication methods failed" even though the native
 * `ssh` CLI works.
 */

// Capture every fake ssh2 Client instance created by SshSession.
class FakeClient extends EventEmitter {
  connectOpts: Record<string, unknown> | null = null;

  constructor() {
    super();
    instances.push(this);
  }

  connect(opts: Record<string, unknown>) {
    // Record the options and leave the connection "pending" — we never emit
    // 'ready'/'error', so connect()'s promise stays unsettled and the test
    // can inspect the wiring without a real network.
    this.connectOpts = opts;
  }

  shell() {
    /* unused in these tests */
  }

  end() {
    /* noop */
  }
}

const instances: FakeClient[] = [];

vi.mock('ssh2', () => ({ Client: FakeClient }));
vi.mock('../../dns-resolver.js', () => ({
  resolveHostname: vi.fn(async (host: string) => host),
}));

// Imported after the mocks are registered.
const { SshSession } = await import('../client.js');

/** Let connect()'s `await resolveHostname()` settle so client.connect() runs. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('SshSession password auth → keyboard-interactive fallback', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('enables tryKeyboard and answers the prompt with the password (ESXi case)', async () => {
    const session = new SshSession({
      host: '192.168.40.46',
      port: 22,
      auth: { type: 'password', username: 'root', password: 'hunter2' },
    });
    // Don't await — connect() stays pending; ignore the eventual rejection.
    session.connect().catch(() => {});
    await flush();

    const client = instances[0];
    expect(client).toBeDefined();
    expect(client.connectOpts?.username).toBe('root');
    expect(client.connectOpts?.password).toBe('hunter2');
    // The key fix: ssh2 only attempts keyboard-interactive when this is set.
    expect(client.connectOpts?.tryKeyboard).toBe(true);

    // Simulate the server's keyboard-interactive challenge.
    const finish = vi.fn();
    client.emit(
      'keyboard-interactive',
      'name',
      'instructions',
      'lang',
      [{ prompt: 'Password:', echo: false }],
      finish,
    );
    expect(finish).toHaveBeenCalledWith(['hunter2']);
  });

  it('answers every prompt for multi-prompt keyboard-interactive servers', async () => {
    const session = new SshSession({
      host: 'host',
      auth: { type: 'password', username: 'root', password: 'pw' },
    });
    session.connect().catch(() => {});
    await flush();

    const client = instances[0];
    const finish = vi.fn();
    client.emit(
      'keyboard-interactive',
      '',
      '',
      '',
      [
        { prompt: 'Password:', echo: false },
        { prompt: 'Password again:', echo: false },
      ],
      finish,
    );
    expect(finish).toHaveBeenCalledWith(['pw', 'pw']);
  });
});

describe('SshSession public-key auth', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('does NOT enable keyboard-interactive (no password to supply)', async () => {
    const session = new SshSession({
      host: 'host',
      auth: {
        type: 'public_key',
        username: 'root',
        keyContent: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----',
      },
    });
    session.connect().catch(() => {});
    await flush();

    const client = instances[0];
    expect(client.connectOpts?.tryKeyboard).toBeUndefined();
    expect(client.listenerCount('keyboard-interactive')).toBe(0);
    expect(client.connectOpts?.privateKey).toBeDefined();
  });

  it('normalizes CRLF to LF in inline key content', async () => {
    const session = new SshSession({
      host: 'host',
      auth: {
        type: 'public_key',
        username: 'root',
        keyContent: 'line1\r\nline2\r\n',
      },
    });
    session.connect().catch(() => {});
    await flush();

    const client = instances[0];
    expect(client.connectOpts?.privateKey).toBe('line1\nline2\n');
  });
});
