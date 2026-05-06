/**
 * Credential store: env OWL_API_KEY first, then ~/.owl/config.json apiKey.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { StoredCredential } from "../types/architecture.js";

const ENV_VAR_NAME = "OWL_API_KEY";
const CONFIG_PATH = join(homedir(), ".owl", "config.json");

export async function getApiKey(): Promise<StoredCredential | null> {
  const envKey = process.env[ENV_VAR_NAME];
  if (envKey?.trim()) {
    return { value: envKey.trim(), source: "env" };
  }
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as {
        apiKey?: string;
      };
      if (config.apiKey?.trim()) {
        return { value: config.apiKey.trim(), source: "file" };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function storeApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey?.trim();
  if (!trimmed || trimmed.length < 8) {
    throw new Error("Invalid API key: must be at least 8 characters");
  }
  const { ConfigManager } = await import("../config.js");
  const config = new ConfigManager();
  config.ensureOwlDir();
  config.setApiKey(trimmed);
}

export function validateApiKeyFormat(apiKey: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!apiKey?.trim()) errors.push("API key is required");
  else if (apiKey.trim().length < 8) errors.push("API key must be at least 8 characters");
  return { valid: errors.length === 0, errors };
}
