import { z } from "zod";

export const ColumnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  isPrimaryKey: z.boolean().default(false),
  isForeignKey: z.boolean().default(false),
});
export type ColumnInfo = z.infer<typeof ColumnInfoSchema>;

export const TableInfoSchema = z.object({
  name: z.string(),
  schema: z.string().default("public"),
  columns: z.array(ColumnInfoSchema),
  rlsEnabled: z.boolean().default(false),
  estimatedRowCount: z.number().optional(),
});
export type TableInfo = z.infer<typeof TableInfoSchema>;

export const RLSPolicySchema = z.object({
  name: z.string(),
  tableName: z.string(),
  schema: z.string(),
  command: z.enum(["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]),
  permissive: z.boolean(),
  roles: z.array(z.string()),
  usingExpression: z.string().nullable(),
  withCheckExpression: z.string().nullable(),
});
export type RLSPolicy = z.infer<typeof RLSPolicySchema>;

export const IndexInfoSchema = z.object({
  name: z.string(),
  tableName: z.string(),
  schema: z.string(),
  columns: z.array(z.string()),
  isUnique: z.boolean(),
  isPrimary: z.boolean(),
  indexSize: z.string().optional(),
});
export type IndexInfo = z.infer<typeof IndexInfoSchema>;

export const ForeignKeyInfoSchema = z.object({
  constraintName: z.string(),
  tableName: z.string(),
  columnName: z.string(),
  referencedTable: z.string(),
  referencedColumn: z.string(),
});
export type ForeignKeyInfo = z.infer<typeof ForeignKeyInfoSchema>;

export const SchemaCacheSchema = z.object({
  projectSlug: z.string(),
  tables: z.array(TableInfoSchema),
  rlsPolicies: z.array(RLSPolicySchema).default([]),
  indexes: z.array(IndexInfoSchema).default([]),
  foreignKeys: z.array(ForeignKeyInfoSchema).default([]),
  introspectedAt: z.string(),
  checksum: z.string(),
});
export type SchemaCache = z.infer<typeof SchemaCacheSchema>;

export const DocumentMetadataSchema = z.object({
  source: z.string(),
  docType: z.enum(["guide", "reference", "example", "migration"]),
  category: z.string(),
  chunkIndex: z.number(),
  totalChunks: z.number(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const DocumentChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: DocumentMetadataSchema,
  embedding: z.array(z.number()),
});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

export const SchemaSelectionResultSchema = z.object({
  tables: z.array(TableInfoSchema),
  rlsPolicies: z.array(RLSPolicySchema),
  indexes: z.array(IndexInfoSchema),
  totalTokens: z.number(),
});
export type SchemaSelectionResult = z.infer<typeof SchemaSelectionResultSchema>;

export enum QueryType {
  HOW_TO = "A",
  PERFORMANCE = "B",
  FIX_SQL = "C",
  SCHEMA_DESIGN = "D",
  GENERAL = "E",
}

export const ClassificationResultSchema = z.object({
  type: z.nativeEnum(QueryType),
  confidence: z.number(),
  keywords: z.array(z.string()),
});
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const RetrievalConfigSchema = z.object({
  knowledgeBaseChunks: z.number(),
  schemaTables: z.number(),
  chatHistoryTurns: z.number(),
  includeSummaries: z.boolean(),
  priorityDocs: z.array(z.string()),
});
export type RetrievalConfig = z.infer<typeof RetrievalConfigSchema>;

export const RAGContextSchema = z.object({
  userQuery: z.string(),
  queryType: z.nativeEnum(QueryType),
  schema: SchemaSelectionResultSchema,
  knowledgeChunks: z.array(DocumentChunkSchema),
  chatHistory: z.array(z.any()),
  tokenCount: z.number(),
});
export type RAGContext = z.infer<typeof RAGContextSchema>;

export const EncryptedConnectionStringSchema = z.object({
  ciphertext: z.string(),
  nonce: z.string(),
  authTag: z.string(),
  version: z.number(),
  keyHash: z.string(),
  createdAt: z.string(),
});
export type EncryptedConnectionString = z.infer<
  typeof EncryptedConnectionStringSchema
>;

export const StoredCredentialSchema = z.object({
  value: z.string(),
  source: z.enum(["keychain", "file", "env"]),
});
export type StoredCredential = z.infer<typeof StoredCredentialSchema>;

export const SQLValidationResultSchema = z.object({
  safe: z.boolean(),
  forbiddenPatterns: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type SQLValidationResult = z.infer<typeof SQLValidationResultSchema>;

export const ApplyGuardConfigSchema = z.object({
  requireConfirmation: z.boolean(),
  requireGitClean: z.boolean(),
  autoWrapTransaction: z.boolean(),
  maxStatements: z.number(),
  allowedStatementTypes: z.array(z.string()),
});
export type ApplyGuardConfig = z.infer<typeof ApplyGuardConfigSchema>;
