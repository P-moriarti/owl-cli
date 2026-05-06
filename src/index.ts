#!/usr/bin/env node

import "dotenv/config";
import chalk from "chalk";
import { Command } from "commander";
import { ConfigManager } from "./config.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerInitCommand } from "./commands/init.js";
import { registerAskCommand } from "./commands/ask.js";
import { registerRefreshCommand } from "./commands/refresh.js";
import { registerListCommand } from "./commands/list.js";
import { registerHistoryCommand } from "./commands/history.js";

const config = new ConfigManager();
const program = new Command();

program
  .name("owl")
  .description("Owl CLI - Supabase schema assistant")
  .version("1.0.0");

registerLoginCommand(program);
registerInitCommand(program, config);
registerAskCommand(program, config);
registerRefreshCommand(program, config);
registerListCommand(program, config);
registerHistoryCommand(program, config);

program
  .command("use <project-slug>")
  .description("Switch active project context")
  .action((projectSlug: string) => {
    if (!projectSlug?.trim()) {
      console.error(chalk.red("Error: project-slug is required"));
      process.exitCode = 1;
      return;
    }
    const slug = projectSlug.trim();
    const projects = config.readConfig().projects ?? {};
    if (!projects[slug]) {
      console.error(
        chalk.yellow("Warning: Project not found. Run `owl init` first.")
      );
      process.exitCode = 1;
      return;
    }
    config.setActiveProjectSlug(slug);
    console.log(chalk.green("Active project:"), chalk.cyan(slug));
  });

program.parse();
