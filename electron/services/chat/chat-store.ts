/**
 * Encrypted local chat database lifecycle.
 *
 * Manages the chat SQLite database file's lock/unlock state alongside the
 * vault. The historical conversation/message tables remain in the schema for
 * backwards compatibility with existing on-disk databases, but no code reads
 * or writes to them — chat history is now owned by the Claude Code / Codex
 * CLIs themselves.
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CREATE_CHAT_SCHEMA, CHAT_SCHEMA_VERSION } from './schema.js';

// ── Crypto constants ─────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000;
const KEY_LEN = 32;
const SALT_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;

/** Domain-separation context — prevents key reuse with the vault. */
const CHAT_KDF_CONTEXT = Buffer.from('conduit-chat-v1');

// ── ChatStore ────────────────────────────────────────────────────────────────

export class ChatStore {
  private dbPath: string;
  private db: Database.Database | null = null;
  private encryptionKey: Buffer | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /** Get the path to the chat database file. */
  getDbPath(): string {
    return this.dbPath;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Create a new chat database with the given master password.
   * Generates a domain-separated salt and stores verification token.
   */
  initialize(masterPassword: string): void {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const salt = crypto.randomBytes(SALT_LEN);
    const key = this.deriveKey(masterPassword, salt);

    try {
      const db = new Database(this.dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.exec(CREATE_CHAT_SCHEMA);

      // Store salt
      db.prepare('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)').run('salt', salt.toString('base64'));
      db.prepare('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)').run('schema_version', String(CHAT_SCHEMA_VERSION));

      // Verification token
      const verification = this.encrypt(Buffer.from('conduit-chat-ok'), key);
      db.prepare('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)').run('verification', verification.toString('base64'));

      this.db = db;
      this.encryptionKey = key;
    } catch (err) {
      key.fill(0);
      throw err;
    }
  }

  /**
   * Unlock an existing chat database with the master password.
   */
  unlock(masterPassword: string): void {
    if (this.isUnlocked()) return;

    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Read salt
    const saltRow = db.prepare('SELECT value FROM chat_meta WHERE key = ?').get('salt') as { value: string } | undefined;
    if (!saltRow) {
      db.close();
      throw new Error('Invalid chat database: no salt stored');
    }
    const salt = Buffer.from(saltRow.value, 'base64');
    const key = this.deriveKey(masterPassword, salt);

    // Verify
    const verRow = db.prepare('SELECT value FROM chat_meta WHERE key = ?').get('verification') as { value: string } | undefined;
    if (!verRow) {
      key.fill(0);
      db.close();
      throw new Error('Invalid chat database: no verification token');
    }

    try {
      const decrypted = this.decrypt(Buffer.from(verRow.value, 'base64'), key);
      if (decrypted.toString('utf-8') !== 'conduit-chat-ok') {
        throw new Error('mismatch');
      }
    } catch {
      key.fill(0);
      db.close();
      throw new Error('Invalid master password for chat database');
    }

    // Run any pending schema migrations
    this.runMigrations(db);

    this.db = db;
    this.encryptionKey = key;
  }

  /**
   * Lock the chat store — zero the key and close the database.
   */
  lock(): void {
    if (this.encryptionKey) {
      this.encryptionKey.fill(0);
      this.encryptionKey = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Change the master password for the chat store.
   * Re-derives the encryption key from the new password and re-encrypts the
   * verification token. The legacy conversations/messages tables are left
   * untouched — historical rows persist with their old encryption and become
   * unreadable, which is expected since chat history is no longer surfaced.
   */
  changePassword(currentPassword: string, newPassword: string): void {
    const { db } = this.requireUnlocked();

    // Verify current password
    const saltRow = db.prepare('SELECT value FROM chat_meta WHERE key = ?').get('salt') as { value: string } | undefined;
    if (!saltRow) throw new Error('Invalid chat database: no salt stored');
    const oldSalt = Buffer.from(saltRow.value, 'base64');
    const verifyKey = this.deriveKey(currentPassword, oldSalt);

    const verRow = db.prepare('SELECT value FROM chat_meta WHERE key = ?').get('verification') as { value: string } | undefined;
    if (!verRow) throw new Error('Invalid chat database: no verification token');

    try {
      const decrypted = this.decrypt(Buffer.from(verRow.value, 'base64'), verifyKey);
      if (decrypted.toString('utf-8') !== 'conduit-chat-ok') throw new Error('mismatch');
    } catch {
      throw new Error('Current password is incorrect for chat database');
    }

    // Generate new salt and key, persist verification token under it.
    const newSalt = crypto.randomBytes(SALT_LEN);
    const newKey = this.deriveKey(newPassword, newSalt);
    const newVerification = this.encrypt(Buffer.from('conduit-chat-ok'), newKey);

    const updateMeta = db.transaction(() => {
      db.prepare('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)').run('salt', newSalt.toString('base64'));
      db.prepare('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)').run('verification', newVerification.toString('base64'));
    });
    updateMeta();

    if (this.encryptionKey) this.encryptionKey.fill(0);
    this.encryptionKey = newKey;
  }

  isUnlocked(): boolean {
    return this.encryptionKey !== null && this.db !== null;
  }

  exists(): boolean {
    return fs.existsSync(this.dbPath);
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private requireUnlocked(): { key: Buffer; db: Database.Database } {
    if (!this.encryptionKey || !this.db) {
      throw new Error('Chat store is locked');
    }
    return { key: this.encryptionKey, db: this.db };
  }

  private deriveKey(password: string, salt: Buffer): Buffer {
    const domainSalt = Buffer.concat([salt, CHAT_KDF_CONTEXT]);
    return crypto.pbkdf2Sync(password, domainSalt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
  }

  private encrypt(data: Buffer, key: Buffer): Buffer {
    const nonce = crypto.randomBytes(NONCE_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ciphertext, tag]);
  }

  private decrypt(encrypted: Buffer, key: Buffer): Buffer {
    if (encrypted.length < NONCE_LEN + TAG_LEN) {
      throw new Error('Ciphertext too short');
    }
    const nonce = encrypted.subarray(0, NONCE_LEN);
    const tag = encrypted.subarray(encrypted.length - TAG_LEN);
    const ciphertext = encrypted.subarray(NONCE_LEN, encrypted.length - TAG_LEN);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private runMigrations(db: Database.Database): void {
    const verRow = db.prepare('SELECT value FROM chat_meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
    const currentVersion = parseInt(verRow?.value ?? '1', 10);
    if (currentVersion >= CHAT_SCHEMA_VERSION) return;

    // v1 → v2: Add metadata column to conversations
    if (currentVersion < 2) {
      db.exec("ALTER TABLE conversations ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
    }

    // v2 → v3: Add engine_sessions table
    if (currentVersion < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS engine_sessions (
          id TEXT PRIMARY KEY,
          engine_type TEXT NOT NULL,
          external_id TEXT,
          model TEXT,
          working_directory TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_engine_sessions_type
          ON engine_sessions(engine_type, updated_at DESC);
      `);
    }

    // v3 → v4: Add engine_session_id column to conversations
    if (currentVersion < 4) {
      db.exec("ALTER TABLE conversations ADD COLUMN engine_session_id TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_engine_session ON conversations(engine_session_id) WHERE engine_session_id IS NOT NULL");
    }

    db.prepare('INSERT OR REPLACE INTO chat_meta (key, value) VALUES (?, ?)').run('schema_version', String(CHAT_SCHEMA_VERSION));
  }
}
