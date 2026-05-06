import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { ConfigManager } from "../config.js";
import { getApiKey } from "../security/credential-store.js";
import { getConnectionString } from "../security/encryption.js";
import { openLocalDb } from "../db/local-sqlite.js";
import { introspectSchema } from "../db/schema-introspect.js";

export function registerRefreshCommand(
  program: Command,
  config: ConfigManager
): void {
  program
    .command("refresh [project-slug]")
    .description("Re-introspect schema for the active (or given) project")
    .action(async (projectSlugArg?: string) => {
      try {
        const slug = projectSlugArg?.trim() ?? config.getActiveProjectSlug();
        if (!slug) {
          console.error(
            chalk.yellow(
              "No active project. Run `owl init` or `owl use <project-slug>` first."
            )
          );
          process.exitCode = 1;
          return;
        }

        const projects = config.readConfig().projects ?? {};
        if (!projects[slug]) {
          console.error(
            chalk.red(
              `Project "${slug}" not found. Run \`owl init\` to set it up.`
            )
          );
          process.exitCode = 1;
          return;
        }

        const credential = await getApiKey();
        if (!credential?.value) {
          console.error(chalk.red("No API key. Run `owl login` first."));
          process.exitCode = 1;
          return;
        }

        const spinDecrypt = ora("Loading connection…").start();
        const connectionString = await getConnectionString(
          config,
          slug,
          credential.value
        );
        if (!connectionString) {
          spinDecrypt.fail("No stored connection string");
          console.error(
            chalk.red(
              `No connection found for "${slug}". Run \`owl init\` to re-initialize it.`
            )
          );
          process.exitCode = 1;
          return;
        }
        spinDecrypt.succeed("Connection loaded");

        const spinIntro = ora("Introspecting schema…").start();
        const schemaCache = await introspectSchema(connectionString, slug);
        const db = openLocalDb(config, slug);
        try {
          db.prepare(
            `INSERT OR REPLACE INTO schema_cache (project_slug, tables_json, introspected_at, checksum)
             VALUES (?, ?, ?, ?)`
          ).run(
            slug,
            JSON.stringify(schemaCache),
            schemaCache.introspectedAt,
            schemaCache.checksum
          );
        } finally {
          db.close();
        }
        spinIntro.succeed(
          `Schema refreshed (${schemaCache.tables.length} tables)`
        );
        console.log(chalk.gray(`Last introspected: ${schemaCache.introspectedAt}`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
