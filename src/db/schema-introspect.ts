import { Client } from "pg";
import { createHash } from "node:crypto";
import {
  GET_TABLE_COLUMNS,
  GET_RLS_POLICIES,
  GET_INDEXES,
  GET_FOREIGN_KEYS,
} from "./introspection-queries.js";
import type {
  SchemaCache,
  TableInfo,
  RLSPolicy,
  IndexInfo,
  ForeignKeyInfo,
} from "../types/architecture.js";

interface TableRow {
  schema_name: string;
  table_name: string;
  rls_enabled: boolean;
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
}

interface RLSRow {
  schema_name: string;
  table_name: string;
  policy_name: string;
  permissive: boolean;
  roles: string[];
  command: string;
  using_expression: string | null;
  with_check_expression: string | null;
}

interface IndexRow {
  schema_name: string;
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  index_size: string | null;
  column_names: string[] | null;
}

interface FKRow {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  referenced_table: string;
  column_names: string[] | null;
  referenced_column_names: string[] | null;
}

function buildSupabasePgConfig(connectionString: string) {
  // Do NOT add sslmode to the URL — pg v8+ treats 'require' as 'verify-full'
  // when set via the connection string, ignoring rejectUnauthorized: false.
  // Passing ssl as an object is the correct way to allow Supabase's managed certs.
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  };
}

export async function introspectSchema(
  connectionString: string,
  projectSlug: string
): Promise<SchemaCache> {
  const client = new Client(buildSupabasePgConfig(connectionString));
  await client.connect();

  try {
    const [colsRes, rlsRes, idxRes, fkRes] = await Promise.all([
      client.query<TableRow>(GET_TABLE_COLUMNS),
      client.query<RLSRow>(GET_RLS_POLICIES),
      client.query<IndexRow>(GET_INDEXES),
      client.query<FKRow>(GET_FOREIGN_KEYS),
    ]);

    const tablesByKey = new Map<string, TableInfo>();
    for (const row of colsRes.rows) {
      const key = `${row.schema_name}.${row.table_name}`;
      let table = tablesByKey.get(key);
      if (!table) {
        table = {
          name: row.table_name,
          schema: row.schema_name,
          columns: [],
          rlsEnabled: row.rls_enabled,
        };
        tablesByKey.set(key, table);
      }
      table.columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable,
        default: row.column_default,
        isPrimaryKey: row.is_primary_key,
        isForeignKey: row.is_foreign_key,
      });
    }
    const tables = Array.from(tablesByKey.values());

    const rlsPolicies: RLSPolicy[] = rlsRes.rows.map((r: RLSRow) => ({
      name: r.policy_name,
      tableName: r.table_name,
      schema: r.schema_name,
      command: r.command as RLSPolicy["command"],
      permissive: r.permissive,
      roles: Array.isArray(r.roles) ? r.roles : [],
      usingExpression: r.using_expression,
      withCheckExpression: r.with_check_expression,
    }));

    const indexes: IndexInfo[] = idxRes.rows.map((r: IndexRow) => ({
      name: r.index_name,
      tableName: r.table_name,
      schema: r.schema_name,
      columns: Array.isArray(r.column_names) ? r.column_names : [],
      isUnique: r.is_unique,
      isPrimary: r.is_primary,
      indexSize: r.index_size ?? undefined,
    }));

    const foreignKeys: ForeignKeyInfo[] = [];
    for (const r of fkRes.rows) {
      const cols = Array.isArray(r.column_names) ? r.column_names : [];
      const refCols = Array.isArray(r.referenced_column_names)
        ? r.referenced_column_names
        : [];
      for (let i = 0; i < cols.length; i++) {
        foreignKeys.push({
          constraintName: r.constraint_name,
          tableName: r.table_name,
          columnName: cols[i] ?? "",
          referencedTable: r.referenced_table,
          referencedColumn: refCols[i] ?? "",
        });
      }
    }

    const introspectedAt = new Date().toISOString();
    const checksum = createHash("sha256")
      .update(JSON.stringify({ tables, rlsPolicies, indexes, foreignKeys }))
      .digest("hex");

    return {
      projectSlug,
      tables,
      rlsPolicies,
      indexes,
      foreignKeys,
      introspectedAt,
      checksum,
    };
  } finally {
    await client.end();
  }
}
