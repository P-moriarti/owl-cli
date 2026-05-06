import chalk from "chalk";
import type { Command } from "commander";
import { ConfigManager } from "../config.js";

export function registerListCommand(
  program: Command,
  config: ConfigManager
): void {
  program
    .command("list")
    .description("List all configured projects")
    .action(() => {
      const cfg = config.readConfig();
      const projects = Object.values(cfg.projects ?? {});

      if (projects.length === 0) {
        console.log(
          chalk.yellow("No projects configured. Run `owl init` to add one.")
        );
        return;
      }

      const active = cfg.activeProjectSlug;
      console.log(chalk.bold(`\nProjects (${projects.length}):\n`));
      for (const project of projects) {
        const isActive = project.slug === active;
        const marker = isActive ? chalk.green("▶") : " ";
        const name = isActive
          ? chalk.green(chalk.bold(project.slug))
          : chalk.white(project.slug);
        const date = project.createdAt
          ? chalk.gray(`  added ${new Date(project.createdAt).toLocaleDateString()}`)
          : "";
        console.log(`  ${marker} ${name}${date}`);
      }

      if (active) {
        console.log(chalk.gray(`\nActive: ${active}`));
      } else {
        console.log(
          chalk.yellow(
            "\nNo active project. Run `owl use <project-slug>` to set one."
          )
        );
      }
      console.log();
    });
}
