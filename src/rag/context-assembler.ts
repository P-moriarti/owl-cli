import type {
  SchemaCache,
  SchemaSelectionResult,
  TableInfo,
  RLSPolicy,
  DocumentChunk,
  QueryType,
  RAGContext,
} from "../types/architecture.js";
import type { ConversationMessage } from "../types/index.js";
import { getRetrievalConfig } from "./classifier.js";

const MAX_TOTAL_TOKENS = 24000;
const SYSTEM_PROMPT_TOKENS = 1500;
const USER_QUERY_TOKENS = 200;
const SAFETY_MARGIN = 500;
const TOKENS_PER_TABLE = 150;
const TOKENS_PER_RLS = 80;
const TOKENS_PER_INDEX = 50;
const TOKENS_PER_CHUNK = 200;
const TOKENS_PER_MESSAGE = 100;

function isSQLKeyword(w: string): boolean {
  const set = new Set([
    "select", "insert", "update", "delete", "where", "and", "or", "null", "true", "false",
  ]);
  return set.has(w.toLowerCase());
}

export function extractTableMentions(query: string): string[] {
  const mentions: string[] = [];
  const patterns = [
    /\bfrom\s+(\w+)\b/gi,
    /\bjoin\s+(\w+)\b/gi,
    /\btable\s+(\w+)\b/gi,
    /\binto\s+(\w+)\b/gi,
    /\bupdate\s+(\w+)\b/gi,
    /\bdelete\s+from\s+(\w+)\b/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) {
      const name = m[1];
      if (name && !isSQLKeyword(name)) mentions.push(name);
    }
  }
  return [...new Set(mentions)];
}

function estimateSchemaTokens(sel: SchemaSelectionResult): number {
  let t = 0;
  for (const table of sel.tables) {
    t += TOKENS_PER_TABLE + table.columns.length * 20;
  }
  t += sel.rlsPolicies.length * TOKENS_PER_RLS;
  t += sel.indexes.length * TOKENS_PER_INDEX;
  return t;
}

function hasRLSPolicy(tableName: string, policies: RLSPolicy[]): boolean {
  return policies.some((p) => p.tableName === tableName);
}

function findRelatedTables(
  names: string[],
  schema: SchemaCache,
  hops: number
): string[] {
  const out = new Set<string>();
  for (const name of names) {
    for (const fk of schema.foreignKeys) {
      if (fk.tableName === name) out.add(fk.referencedTable);
      if (fk.referencedTable === name) out.add(fk.tableName);
    }
  }
  if (hops > 1) {
    const next = findRelatedTables([...out], schema, hops - 1);
    next.forEach((n) => out.add(n));
  }
  return [...out];
}

export async function selectSchemaTables(
  query: string,
  _queryEmbedding: number[],
  schema: SchemaCache,
  maxTokens = 8000
): Promise<SchemaSelectionResult> {
  const selected = new Set<string>();
  const result: SchemaSelectionResult = {
    tables: [],
    rlsPolicies: [],
    indexes: [],
    totalTokens: 0,
  };

  const mentioned = extractTableMentions(query);
  for (const name of mentioned) {
    const table = schema.tables.find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (table && !selected.has(table.name)) {
      selected.add(table.name);
      result.tables.push(table);
    }
  }

  const limit = 15;
  for (const table of schema.tables.slice(0, limit)) {
    if (!selected.has(table.name)) {
      selected.add(table.name);
      result.tables.push(table);
    }
  }

  if (/\b(rls|policy|auth|permission|security)\b/i.test(query)) {
    const withRls = schema.tables.filter(
      (t) => t.rlsEnabled || hasRLSPolicy(t.name, schema.rlsPolicies)
    );
    for (const t of withRls) {
      if (!selected.has(t.name)) {
        selected.add(t.name);
        result.tables.push(t);
      }
    }
    result.rlsPolicies = schema.rlsPolicies;
  }

  const related = findRelatedTables([...selected], schema, 1);
  for (const name of related) {
    if (!selected.has(name)) {
      const t = schema.tables.find((x) => x.name === name);
      if (t) {
        selected.add(name);
        result.tables.push(t);
      }
    }
  }

  result.indexes = schema.indexes.filter((i) => selected.has(i.tableName));
  result.rlsPolicies = schema.rlsPolicies.filter((p) =>
    selected.has(p.tableName)
  );
  result.totalTokens = estimateSchemaTokens(result);
  while (result.totalTokens > maxTokens && result.tables.length > 3) {
    const removed = result.tables.pop();
    if (removed) selected.delete(removed.name);
    result.totalTokens = estimateSchemaTokens(result);
  }
  return result;
}

export function selectKnowledgeChunks(
  _queryEmbedding: number[],
  queryType: QueryType,
  allChunks: DocumentChunk[],
  maxTokens: number
): DocumentChunk[] {
  const config = getRetrievalConfig(queryType);
  const maxChunks = Math.floor(maxTokens / TOKENS_PER_CHUNK);
  const n = Math.min(config.knowledgeBaseChunks, maxChunks);
  return allChunks.slice(0, n);
}

export function selectChatHistory(
  history: ConversationMessage[],
  queryType: QueryType,
  maxTokens: number
): ConversationMessage[] {
  const config = getRetrievalConfig(queryType);
  const maxMsg = Math.floor(maxTokens / TOKENS_PER_MESSAGE);
  const n = Math.min(config.chatHistoryTurns * 2, maxMsg);
  return history.slice(-n);
}

export async function assembleRAGContext(params: {
  userQuery: string;
  queryType: QueryType;
  queryEmbedding: number[];
  schema: SchemaCache;
  knowledgeChunks: DocumentChunk[];
  chatHistory: ConversationMessage[];
}): Promise<RAGContext> {
  const {
    userQuery,
    queryType,
    queryEmbedding,
    schema,
    knowledgeChunks,
    chatHistory,
  } = params;
  const available =
    MAX_TOTAL_TOKENS -
    SYSTEM_PROMPT_TOKENS -
    USER_QUERY_TOKENS -
    SAFETY_MARGIN;
  const schemaBudget = Math.floor(available * 0.4);
  const knowledgeBudget = Math.floor(available * 0.35);
  const historyBudget = Math.floor(available * 0.25);

  const schemaSelection = await selectSchemaTables(
    userQuery,
    queryEmbedding,
    schema,
    schemaBudget
  );
  const chunks = selectKnowledgeChunks(
    queryEmbedding,
    queryType,
    knowledgeChunks,
    knowledgeBudget
  );
  const history = selectChatHistory(chatHistory, queryType, historyBudget);

  const tokenCount =
    SYSTEM_PROMPT_TOKENS +
    USER_QUERY_TOKENS +
    schemaSelection.totalTokens +
    chunks.length * TOKENS_PER_CHUNK +
    history.length * TOKENS_PER_MESSAGE;

  return {
    userQuery,
    queryType,
    schema: schemaSelection,
    knowledgeChunks: chunks,
    chatHistory: history,
    tokenCount,
  };
}

export function formatSchemaForPrompt(sel: SchemaSelectionResult): string {
  const lines: string[] = [];
  for (const table of sel.tables) {
    lines.push(`\nTable: ${table.schema}.${table.name}`);
    if (table.rlsEnabled) lines.push("  RLS: ENABLED");
    lines.push("  Columns:");
    for (const col of table.columns) {
      const n = col.nullable ? "" : " NOT NULL";
      const d = col.default ? ` DEFAULT ${col.default}` : "";
      const pk = col.isPrimaryKey ? " [PK]" : "";
      const fk = col.isForeignKey ? " [FK]" : "";
      lines.push(`    - ${col.name}: ${col.type}${n}${d}${pk}${fk}`);
    }
  }
  if (sel.rlsPolicies.length > 0) {
    lines.push("\nRLS Policies:");
    for (const p of sel.rlsPolicies) {
      lines.push(`  ${p.tableName}: ${p.name} (${p.command})`);
      lines.push(`    Using: ${p.usingExpression ?? "N/A"}`);
    }
  }
  if (sel.indexes.length > 0) {
    lines.push("\nIndexes:");
    for (const i of sel.indexes) {
      lines.push(`  ${i.name}: ${i.columns.join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function formatRAGPrompt(context: RAGContext): string {
  const parts: string[] = [];
  parts.push("--- DATABASE SCHEMA ---");
  parts.push(formatSchemaForPrompt(context.schema));
  if (context.knowledgeChunks.length > 0) {
    parts.push("\n--- RELEVANT DOCUMENTATION ---");
    for (const c of context.knowledgeChunks) {
      parts.push(`\n[${c.metadata.category}]`);
      parts.push(c.content);
    }
  }
  if (context.chatHistory.length > 0) {
    parts.push("\n--- CONVERSATION HISTORY ---");
    for (const m of context.chatHistory) {
      const role = m.role.toUpperCase();
      const content =
        m.content.length > 300 ? m.content.slice(0, 300) + "..." : m.content;
      parts.push(`${role}: ${content}`);
    }
  }
  parts.push("\n--- USER QUESTION ---");
  parts.push(context.userQuery);
  return parts.join("\n");
}
