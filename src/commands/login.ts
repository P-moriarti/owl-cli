import inquirer from "inquirer";
import chalk from "chalk";
import type { Command } from "commander";
import { storeApiKey, validateApiKeyFormat } from "../security/index.js";

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with API key and store in credential store")
    .action(async () => {
      try {
        const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
          {
            type: "password",
            name: "apiKey",
            message: "Enter your API key:",
            mask: "*",
            validate: (input: string) => {
              const result = validateApiKeyFormat(input ?? "");
              return result.valid ? true : result.errors.join("; ");
            },
          },
        ]);

        const trimmed = apiKey.trim();
        await storeApiKey(trimmed);

        console.log(
          chalk.green("Success: API key saved to credential store (~/.owl/config.json, chmod 600)")
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
