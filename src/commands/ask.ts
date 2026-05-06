import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { ConfigManager } from "../config.js";
import { openLocalDb } from "../db/local-sqlite.js";
import {
  getOrCreateSessionId,
  getRecentHistory,
  getCrossSessionHistory,
  saveMessage,
  pruneOldSessions,
} from "../db/conversation-store.js";
import {
  classifyQuery,
  getQueryTypeLabel,
  assembleRAGContext,
  formatRAGPrompt,
} from "../rag/index.js";
import { getSystemPrompt } from "../prompts/system-prompts.js";
import { embed, completeStream } from "../api/llm-client.js";
import type { SchemaCache } from "../types/architecture.js";
import type { ConversationMessage } from "../types/index.js";

function loadSchemaFromCache(
  config: ConfigManager,
  projectSlug: string
): SchemaCache | null {
  const db = openLocalDb(config, projectSlug);
  try {
    const row = db
      .prepare(
        "SELECT tables_json, introspected_at, checksum FROM schema_cache WHERE project_slug = ?"
      )
      .get(projectSlug) as
      | {
          tables_json: string;
          introspected_at: string;
          checksum: string;
        }
      | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.tables_json) as unknown;
    return {
      ...(parsed as SchemaCache),
      introspectedAt: row.introspected_at,
      checksum: row.checksum,
    };
  } finally {
    db.close();
  }
}

export function registerAskCommand(
  program: Command,
  config: ConfigManager
): void {
  program
    .command("ask <question>")
    .description("Main RAG query: schema context + LLM answer")
    .action(async (question: string) => {
      let db: ReturnType<typeof openLocalDb> | null = null;
      try {
        if (!question?.trim()) {
          console.error(chalk.red("Error: question is required"));
          process.exitCode = 1;
          return;
        }
        const slug = config.getActiveProjectSlug();
        if (!slug) {
          console.error(
            chalk.yellow(
              "Warning: No active project. Run `owl init` or `owl use <project-slug>`."
            )
          );
          process.exitCode = 1;
          return;
        }

        const spinner = ora("Building context and querying…").start();
        const schema = loadSchemaFromCache(config, slug);
        if (!schema) {
          spinner.fail("No schema cache");
          console.error(
            chalk.yellow(
              "Run `owl init` for this project to introspect the schema first."
            )
          );
          process.exitCode = 1;
          return;
        }

        // Load conversation history from local SQLite
        db = openLocalDb(config, slug);
        const sessionId = getOrCreateSessionId(slug);
        pruneOldSessions(db);
        const todayHistory = getRecentHistory(db, sessionId);
        const pastHistory = getCrossSessionHistory(db, sessionId);
        // Merge: past sessions first (oldest context), then today's session
        const chatHistory: ConversationMessage[] = [...pastHistory, ...todayHistory];

        const queryType = classifyQuery(question);
        const queryEmbedding = await embed(question);
        const knowledgeChunks: import("../types/architecture.js").DocumentChunk[] = [];

        const ragContext = await assembleRAGContext({
          userQuery: question.trim(),
          queryType: queryType.type,
          queryEmbedding,
          schema,
          knowledgeChunks,
          chatHistory,
        });

        const systemPrompt = getSystemPrompt("ask");
        const userPrompt = formatRAGPrompt(ragContext);

        // Save user message before LLM call
        saveMessage(db, sessionId, "user", question.trim());

        spinner.stop();
        console.log(chalk.cyan("Question:"), question.trim());
        console.log(chalk.gray(`Type: ${getQueryTypeLabel(queryType.type)}`));
        if (chatHistory.length > 0) {
          const parts: string[] = [];
          if (todayHistory.length > 0) parts.push(`${todayHistory.length} today`);
          if (pastHistory.length > 0) parts.push(`${pastHistory.length} from past sessions`);
          console.log(chalk.gray(`Memory: ${parts.join(", ")}`));
        }
        console.log(chalk.green("\nAnswer:\n"));

        let fullResponse = "";
        await completeStream(systemPrompt, userPrompt, (chunk) => {
          process.stdout.write(chunk);
          fullResponse += chunk;
        });
        process.stdout.write("\n");

        // Save assistant response
        saveMessage(db, sessionId, "assistant", fullResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      } finally {
        if (db) db.close();
      }
    });
}
