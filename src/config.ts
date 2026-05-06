import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ConfigSchema, type Config } from "./types/index.js";

const OWL_DIR_NAME = ".owl";
const CONFIG_FILE_NAME = "config.json";
const CONFIG_FILE_MODE = 0o600;

export class ConfigManager {
  private readonly owlDir: string;
  private readonly configPath: string;

  constructor() {
    this.owlDir = join(homedir(), OWL_DIR_NAME);
    this.configPath = join(this.owlDir, CONFIG_FILE_NAME);
  }

  getOwlDir(): string {
    return this.owlDir;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  ensureOwlDir(): void {
    if (!existsSync(this.owlDir)) {
      mkdirSync(this.owlDir, { mode: 0o700, recursive: true });
    }
  }

  readConfig(): Config {
    this.ensureOwlDir();
    if (!existsSync(this.configPath)) {
      return ConfigSchema.parse({});
    }
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return ConfigSchema.parse(parsed);
    } catch {
      return ConfigSchema.parse({});
    }
  }

  writeConfig(config: Config): void {
    this.ensureOwlDir();
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { mode: 0o700, recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
      flag: "w",
    });
    try {
      chmodSync(this.configPath, CONFIG_FILE_MODE);
    } catch {
      /* ignore */
    }
  }

  updateConfig(updates: Partial<Config>): Config {
    const current = this.readConfig();
    const next: Config = {
      ...current,
      ...updates,
      projects:
        updates.projects !== undefined ? updates.projects : current.projects,
    };
    this.writeConfig(next);
    return next;
  }

  getApiKey(): string | undefined {
    return this.readConfig().apiKey;
  }

  setApiKey(apiKey: string): void {
    this.updateConfig({ apiKey });
  }

  getActiveProjectSlug(): string | undefined {
    return this.readConfig().activeProjectSlug;
  }

  setActiveProjectSlug(slug: string): void {
    this.updateConfig({ activeProjectSlug: slug });
  }

  getProject(slug: string): Config["projects"][string] | undefined {
    return this.readConfig().projects?.[slug];
  }
}
