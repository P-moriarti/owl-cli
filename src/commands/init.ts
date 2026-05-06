import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { ConfigManager } from "../config.js";
import { validateConnectionString } from "../api/supabase-client.js";
import { openLocalDb } from "../db/local-sqlite.js";
import { getApiKey } from "../security/credential-store.js";
import {
  encryptConnectionString,
  storeEncryptedConnection,
} from "../security/encryption.js";
import { introspectSchema } from "../db/schema-introspect.js";

export function registerInitCommand(
  program: Command,
  config: ConfigManager
): void {
  program
    .command("init")
    .description(
      "Project initialization: connection string, validation, schema introspection, encrypted storage"
    )
    .action(async () => {
      try {
        const credential = await getApiKey();
        if (!credential?.value) {
          console.error(
            chalk.red(
              "Error: No API key found. Run `owl login` first to store your API key."
            )
          );
          process.exitCode = 1;
          return;
        }
        const apiKey = credential.value;

        const answers = await inquirer.prompt<{
          projectSlug: string;
          connectionString: string;
        }>([
          {
            type: "input",
            name: "projectSlug",
            message: "Project slug (e.g. my-app):",
            validate: (input: string) =>
              /^[a-zA-Z0-9-_]+$/.test(input?.trim() ?? "")
                ? true
                : "Use only letters, numbers, hyphens, and underscores",
          },
          {
            type: "password",
            name: "connectionString",
            message: "Postgres connection string:",
            mask: "*",
            validate: (input: string) =>
              (input?.trim() ?? "").length >= 1
                ? true
                : "Connection string cannot be empty",
          },
        ]);

        const projectSlug = answers.projectSlug.trim();
        const connectionString = answers.connectionString.trim();

        const spinValidate = ora("Validating connection…").start();
        const valid = await validateConnectionString(connectionString);
        if (!valid) {
          spinValidate.fail("Connection failed");
          console.error(
            chalk.red(
              "Error: Could not connect to the database. Check the connection string."
            )
          );
          process.exitCode = 1;
          return;
        }
        spinValidate.succeed("Connection validated");

        const spinEncrypt = ora("Encrypting and storing connection string…").start();
        const encrypted = await encryptConnectionString(connectionString, apiKey);
        storeEncryptedConnection(config, projectSlug, encrypted);
        spinEncrypt.succeed("Connection string stored securely");

        config.ensureOwlDir();
        const current = config.readConfig();
        const projects = {
          ...current.projects,
          [projectSlug]: {
            slug: projectSlug,
            createdAt: new Date().toISOString(),
          },
        };
        config.updateConfig({
          projects,
          activeProjectSlug: projectSlug,
        });

        const spinIntro = ora("Introspecting schema…").start();
        const schemaCache = await introspectSchema(connectionString, projectSlug);
        const db = openLocalDb(config, projectSlug);
        try {
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO schema_cache (project_slug, tables_json, introspected_at, checksum)
            VALUES (?, ?, ?, ?)
          `);
          stmt.run(
            projectSlug,
            JSON.stringify(schemaCache),
            schemaCache.introspectedAt,
            schemaCache.checksum
          );
        } finally {
          db.close();
        }
        spinIntro.succeed(
          `Schema cached (${schemaCache.tables.length} tables)`
        );

        console.log(
          chalk.green(
            `\nProject "${projectSlug}" initialized and set as active.`
          )
        );
        console.log(chalk.gray(`Run ${chalk.white("owl ask")} to query your schema.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
