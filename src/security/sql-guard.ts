/**
 * SQL Guard Module
 *
 * Validates SQL for dangerous patterns and provides safe execution guards.
 * Prevents SQL injection and destructive operations.
 */

import type { SQLValidationResult, ApplyGuardConfig } from "../types/architecture.js";

// Default configuration for apply guard
export const DEFAULT_APPLY_GUARD: ApplyGuardConfig = {
  requireConfirmation: true,
  requireGitClean: true,
  autoWrapTransaction: true,
  maxStatements: 10,
  allowedStatementTypes: [
    "CREATE",
    "ALTER",
    "INSERT",
    "UPDATE",
    "DELETE",
    "SELECT",
    "GRANT",
    "REVOKE",
    "COMMENT",
    "DROP", // Allowed but with extra scrutiny
  ],
};

interface ForbiddenPattern {
  pattern: RegExp;
  severity: "error" | "warning";
  message: string;
  category: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  // Destructive operations
  { pattern: /\bDROP\s+DATABASE\b/i, severity: "error", message: "DROP DATABASE is forbidden", category: "destructive" },
  { pattern: /\bDROP\s+SCHEMA\s+\w+/i, severity: "error", message: "DROP SCHEMA is forbidden", category: "destructive" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, severity: "error", message: "TRUNCATE is forbidden (use DELETE with WHERE instead)", category: "destructive" },

  // Dangerous DELETE/UPDATE
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(?!.*\bWHERE\b)/i, severity: "error", message: "DELETE without WHERE clause is forbidden", category: "data-loss" },
  { pattern: /\bUPDATE\s+\w+\s+SET\s+(?!.*\bWHERE\b)/i, severity: "error", message: "UPDATE without WHERE clause is forbidden", category: "data-loss" },

  // System tables access
  { pattern: /\b(pg_catalog|information_schema)\s*\.\s*\w+/i, severity: "error", message: "System schema access is forbidden", category: "security" },

  // Dangerous functions
  { pattern: /\bpg_read_file\s*\(/i, severity: "error", message: "pg_read_file is forbidden (file system access)", category: "security" },
  { pattern: /\bpg_write_file\s*\(/i, severity: "error", message: "pg_write_file is forbidden (file system access)", category: "security" },
  { pattern: /\bpg_execute_server_program\s*\(/i, severity: "error", message: "pg_execute_server_program is forbidden (command execution)", category: "security" },
  { pattern: /\bCOPY\s+.*\s+FROM\s+PROGRAM/i, severity: "error", message: "COPY FROM PROGRAM is forbidden (command execution)", category: "security" },
  { pattern: /\blo_import\s*\(/i, severity: "error", message: "lo_import is forbidden (file system access)", category: "security" },

  // User/role management
  { pattern: /\bDROP\s+(USER|ROLE)\s+\w+/i, severity: "error", message: "DROP USER/ROLE is forbidden", category: "security" },
  { pattern: /\bALTER\s+(USER|ROLE)\s+\w+\s+WITH\s+SUPERUSER/i, severity: "error", message: "Granting SUPERUSER is forbidden", category: "security" },

  // Warnings
  { pattern: /\bCREATE\s+EXTENSION\s+\w+/i, severity: "warning", message: "Creating extensions requires review", category: "caution" },
  { pattern: /\bDROP\s+(TABLE|INDEX|VIEW|MATERIALIZED\s+VIEW|FUNCTION)\b/i, severity: "warning", message: "DROP operation - ensure data is backed up", category: "destructive" },
  { pattern: /\bALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN\b/i, severity: "warning", message: "Dropping columns causes data loss", category: "data-loss" },
  { pattern: /\bALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\b.*\bDROP\s+DEFAULT\b/i, severity: "warning", message: "Dropping defaults may affect application behavior", category: "caution" },
  { pattern: /\bALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\s+\w+\s+TYPE\b/i, severity: "warning", message: "ALTER COLUMN TYPE rewrites the entire table (locks)", category: "performance" },
  { pattern: /\bGRANT\s+ALL\s+.*\s+TO\s+PUBLIC\b/i, severity: "warning", message: "Granting to PUBLIC may be overly permissive", category: "security" },
  { pattern: /\bSECURITY\s+DEFINER\b/i, severity: "warning", message: "SECURITY DEFINER functions run with elevated privileges - review carefully", category: "security" },
  { pattern: /\bSET\s+search_path\s*=\s*\w+/i, severity: "warning", message: "Changing search_path can affect function resolution", category: "caution" },
];

function normalizeSQL(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateSQL(sql: string): SQLValidationResult {
  const result: SQLValidationResult = {
    safe: true,
    forbiddenPatterns: [],
    warnings: [],
  };
  const normalizedSql = normalizeSQL(sql);
  for (const { pattern, severity, message, category } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalizedSql)) {
      if (severity === "error") {
        result.safe = false;
        result.forbiddenPatterns.push(`[${category}] ${message}`);
      } else {
        result.warnings.push(`[${category}] ${message}`);
      }
    }
  }
  return result;
}

export function parseStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prev = sql[i - 1];
    if ((char === "'" || char === '"') && prev !== "\\") {
      if (inQuote === char) inQuote = null;
      else if (!inQuote) inQuote = char;
    }
    if (char === ";" && !inQuote) {
      if (current.trim()) { statements.push(current.trim()); current = ""; }
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function hasDestructiveOperations(sql: string): boolean {
  const destructive = [
    /\bDROP\s+(TABLE|COLUMN|INDEX|VIEW|SCHEMA|DATABASE)\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bALTER\s+.*\s+DROP\b/i,
  ];
  const normalized = normalizeSQL(sql);
  return destructive.some((p) => p.test(normalized));
}

export function shouldWrapInTransaction(sql: string): boolean {
  if (parseStatements(sql).length > 1) return true;
  const transactional = [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /\bALTER\s+TABLE\b/i];
  return transactional.some((p) => p.test(normalizeSQL(sql)));
}

export function getSafetyRecommendations(sql: string): string[] {
  const recommendations: string[] = [];
  const normalized = normalizeSQL(sql);
  const statements = parseStatements(sql);

  if (statements.length > 1 && !/\bBEGIN\b/i.test(normalized)) {
    recommendations.push("Consider wrapping multiple statements in a transaction");
  }
  if (/\b(UPDATE|DELETE)\b/i.test(normalized) && !/\bLIMIT\b/i.test(normalized)) {
    recommendations.push("Consider adding LIMIT to UPDATE/DELETE for large tables");
  }
  if (/\bCREATE\s+INDEX\b/i.test(normalized) && !/\bCONCURRENTLY\b/i.test(normalized)) {
    recommendations.push("Use CREATE INDEX CONCURRENTLY to avoid locking on large tables");
  }
  if (/\bALTER\s+TABLE\b.*\bALTER\s+COLUMN\b/i.test(normalized)) {
    recommendations.push("ALTER COLUMN rewrites the table - consider running during low traffic");
  }
  return recommendations;
}

export function formatValidationResult(result: SQLValidationResult): string {
  const lines: string[] = [];
  if (!result.safe) {
    lines.push("FORBIDDEN PATTERNS DETECTED:");
    for (const p of result.forbiddenPatterns) lines.push(`  * ${p}`);
  }
  if (result.warnings.length > 0) {
    lines.push("WARNINGS:");
    for (const w of result.warnings) lines.push(`  * ${w}`);
  }
  if (result.safe && result.warnings.length === 0) {
    lines.push("No issues detected");
  }
  return lines.join("\n");
}

export function generateRollbackSql(sql: string): string | undefined {
  const normalized = normalizeSQL(sql);
  const createTable = normalized.match(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
  if (createTable) return `-- Rollback: DROP TABLE IF EXISTS ${createTable[1]};`;
  const addColumn = normalized.match(/\bALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i);
  if (addColumn) return `-- Rollback: ALTER TABLE ${addColumn[1]} DROP COLUMN IF EXISTS ${addColumn[2]};`;
  const createIndex = normalized.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
  if (createIndex) return `-- Rollback: DROP INDEX IF EXISTS ${createIndex[1]};`;
  return undefined;
}
