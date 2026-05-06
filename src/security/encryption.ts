/**
 * AES-256-GCM encryption for connection strings.
 */

import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scrypt,
} from "node:crypto";
import { promisify } from "node:util";
import type { ConfigManager } from "../config.js";
import { openLocalDb } from "../db/local-sqlite.js";
import type { EncryptedConnectionString } from "../types/architecture.js";

const scryptAsync = promisify(scrypt);
const DEFAULT_PEPPER = "owl-static-pepper-v1-change-in-prod";
if (!process.env.OWL_SERVER_PEPPER) {
  process.emitWarning(
    "OWL_SERVER_PEPPER is not set. Using default pepper weakens encryption. " +
      "Set OWL_SERVER_PEPPER in your environment for production use.",
    "OwlSecurityWarning"
  );
}
const SERVER_PEPPER = process.env.OWL_SERVER_PEPPER || DEFAULT_PEPPER;
const CURRENT_ENCRYPTION_VERSION = 1;
const SCRYPT_KEY_LEN = 32;

interface EncryptionKey {
  key: Buffer;
  salt: Buffer;
}

async function deriveEncryptionKey(
  apiKey: string,
  salt?: Buffer
): Promise<EncryptionKey> {
  const useSalt = salt ?? randomBytes(32);
  const combined = `${apiKey}:${SERVER_PEPPER}`;
  const key = (await scryptAsync(
    combined,
    useSalt,
    SCRYPT_KEY_LEN
  )) as Buffer;
  return { key, salt: useSalt };
}

export interface EncryptedWithSalt extends EncryptedConnectionString {
  salt: string;
}

export async function encryptConnectionString(
  connectionString: string,
  apiKey: string
): Promise<EncryptedWithSalt> {
  if (!connectionString || connectionString.length < 10) {
    throw new Error("Invalid connection string: too short");
  }
  if (!apiKey || apiKey.length < 8) {
    throw new Error("Invalid API key: must be at least 8 characters");
  }
  const { key, salt } = await deriveEncryptionKey(apiKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  let ciphertext = cipher.update(connectionString, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  const keyHash = createHash("sha256").update(key).digest("hex");
  return {
    ciphertext,
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64"),
    version: CURRENT_ENCRYPTION_VERSION,
    keyHash,
    createdAt: new Date().toISOString(),
    salt: salt.toString("base64"),
  };
}

export async function decryptConnectionString(
  encrypted: EncryptedWithSalt,
  apiKey: string
): Promise<string> {
  if (encrypted.version !== CURRENT_ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${encrypted.version}`);
  }
  const salt = Buffer.from(encrypted.salt, "base64");
  const nonce = Buffer.from(encrypted.nonce, "base64");
  const authTag = Buffer.from(encrypted.authTag, "base64");
  const { key } = await deriveEncryptionKey(apiKey, salt);
  const computedHash = createHash("sha256").update(key).digest("hex");
  if (computedHash !== encrypted.keyHash) {
    throw new Error("Decryption failed: Invalid API key");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  let plain = decipher.update(encrypted.ciphertext, "base64", "utf8");
  plain += decipher.final("utf8");
  return plain;
}

export function storeEncryptedConnection(
  config: ConfigManager,
  projectSlug: string,
  encrypted: EncryptedWithSalt
): void {
  const db = openLocalDb(config, projectSlug);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS encrypted_connections (
        project_slug TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        salt TEXT NOT NULL,
        version INTEGER NOT NULL,
        key_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.prepare(
      `INSERT OR REPLACE INTO encrypted_connections (project_slug, ciphertext, nonce, auth_tag, salt, version, key_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectSlug,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
      encrypted.salt,
      encrypted.version,
      encrypted.keyHash,
      encrypted.createdAt
    );
  } finally {
    db.close();
  }
}

export async function getConnectionString(
  config: ConfigManager,
  projectSlug: string,
  apiKey: string
): Promise<string | null> {
  const db = openLocalDb(config, projectSlug);
  try {
    const row = db
      .prepare(
        "SELECT ciphertext, nonce, auth_tag, salt, version, key_hash, created_at FROM encrypted_connections WHERE project_slug = ?"
      )
      .get(projectSlug) as
      | {
          ciphertext: string;
          nonce: string;
          auth_tag: string;
          salt: string;
          version: number;
          key_hash: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    const enc: EncryptedWithSalt = {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.auth_tag,
      salt: row.salt,
      version: row.version,
      keyHash: row.key_hash,
      createdAt: row.created_at,
    };
    return await decryptConnectionString(enc, apiKey);
  } finally {
    db.close();
  }
}

export function hasConnectionString(
  config: ConfigManager,
  projectSlug: string
): boolean {
  const db = openLocalDb(config, projectSlug);
  try {
    const row = db
      .prepare(
        "SELECT 1 FROM encrypted_connections WHERE project_slug = ? LIMIT 1"
      )
      .get(projectSlug);
    return !!row;
  } finally {
    db.close();
  }
}
