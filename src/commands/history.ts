import chalk from "chalk";
import type { Command } from "commander";
import { ConfigManager } from "../config.js";
import { openLocalDb } from "../db/local-sqlite.js";
import {
  getOrCreateSessionId,
  listSessions,
  getSessionMessages,
} from "../db/conversation-store.js";

const TRUNCATE_LEN = 120;

function formatDate(sessionId: string): string {
  // session IDs are slug-YYYY-MM-DD
  const match = sessionId.match(/(\d{4}-\d{2}-\d{2})$/);
  if (!match?.[1]) return sessionId;
  const date = match[1];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (date === today) return `${date}  ${chalk.green("(today)")}`;
  if (date === yesterday) return `${date}  ${chalk.yellow("(yesterday)")}`;
  return date;
}

function truncate(text: string, len: number): string {
  if (text.length <= len) return text;
  return text.slice(0, len) + chalk.gray("…");
}

export function registerHistoryCommand(
  program: Command,
  config: ConfigManager
): void {
  program
    .command("history")
    .description("Show conversation history for the active project")
    .option("-d, --days <n>", "How many days back to show", "7")
    .option("-f, --full", "Show full message content instead of truncated")
    .action((opts: { days: string; full?: boolean }) => {
      const slug = config.getActiveProjectSlug();
      if (!slug) {
        console.error(
          chalk.yellow("No active project. Run `owl init` or `owl use <slug>`.")
        );
        process.exitCode = 1;
        return;
      }

      const keepDays = Math.max(1, parseInt(opts.days, 10) || 7);
      const showFull = !!opts.full;
      const currentSessionId = getOrCreateSessionId(slug);

      const db = openLocalDb(config, slug);
      try {
        const sessions = listSessions(db, keepDays);

        if (sessions.length === 0) {
          console.log(chalk.gray(`No history found for "${slug}" in the last ${keepDays} day${keepDays === 1 ? "" : "s"}.`));
          console.log(chalk.gray("Start a conversation with `owl ask`."));
          return;
        }

        console.log(
          chalk.bold(`\nHistory for project: ${chalk.cyan(slug)}`) +
          chalk.gray(` (last ${keepDays} day${keepDays === 1 ? "" : "s"})`)
        );

        for (const session of sessions) {
          const isToday = session.session_id === currentSessionId;
          const msgWord = session.message_count === 1 ? "message" : "messages";
          const header = `\n  ${formatDate(session.session_id)}  ·  ${session.message_count} ${msgWord}`;
          console.log(isToday ? chalk.bold(header) : header);
          console.log("  " + chalk.gray("─".repeat(50)));

          const messages = getSessionMessages(db, session.session_id);

          // Group into user/assistant pairs for cleaner display
          let displayed = 0;
          const displayLimit = showFull ? messages.length : 4; // show 2 turns by default

          for (const msg of messages.slice(0, displayLimit * 2)) {
            const isUser = msg.role === "user";
            const label = isUser
              ? chalk.cyan("  YOU ")
              : chalk.green("  OWL ");
            const content = showFull
              ? msg.content
              : truncate(msg.content, TRUNCATE_LEN);
            console.log(`${label} ${content}`);
            displayed++;
          }

          const remaining = messages.length - displayed;
          if (remaining > 0) {
            console.log(
              chalk.gray(`\n  … and ${remaining} more message${remaining === 1 ? "" : "s"}.`) +
              chalk.gray(" Use --full to see all.")
            );
          }
        }
        console.log();
      } finally {
        db.close();
      }
    });
}
