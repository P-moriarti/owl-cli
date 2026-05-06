/**
 * Fast pg_catalog queries for schema introspection.
 */

import { Client } from "pg";

export async function validateConnectionString(
  connectionString: string
): Promise<boolean> {
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end();
  }
}

export const GET_TABLE_COLUMNS = `
WITH table_columns AS (
  SELECT 
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
    NOT a.attnotnull AS is_nullable,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint con WHERE con.conrelid = c.oid AND con.contype = 'p' AND a.attnum = ANY(con.conkey)) AS is_primary_key,
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint con WHERE con.conrelid = c.oid AND con.contype = 'f' AND a.attnum = ANY(con.conkey)) AS is_foreign_key
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE (
    n.nspname = 'public'
    OR (n.nspname = 'auth' AND c.relname = 'users')
  )
    AND c.relkind IN ('r', 'v', 'm', 'f')
    AND c.relpersistence = 'p'
)
SELECT * FROM table_columns ORDER BY schema_name, table_name, column_name;
`;

export const GET_RLS_POLICIES = `
SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
  permissive, roles, cmd AS command, qual AS using_expression, with_check AS with_check_expression
FROM pg_catalog.pg_policies
WHERE schemaname = 'public';
`;

export const GET_INDEXES = `
SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
  ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
  pg_catalog.pg_size_pretty(pg_catalog.pg_relation_size(i.oid)) AS index_size,
  (SELECT array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum))
   FROM pg_catalog.pg_attribute a WHERE a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) AND NOT a.attisdropped
  ) AS column_names
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE (
  n.nspname = 'public'
  OR (n.nspname = 'auth' AND t.relname = 'users')
)
ORDER BY n.nspname, t.relname, i.relname;
`;

export const GET_FOREIGN_KEYS = `
SELECT n.nspname AS schema_name, cl.relname AS table_name, c.conname AS constraint_name,
  (SELECT cl2.relname FROM pg_catalog.pg_class cl2 WHERE cl2.oid = c.confrelid) AS referenced_table,
  (SELECT array_agg(a.attname ORDER BY ord) FROM unnest(c.conkey) WITH ORDINALITY AS cols(col, ord) JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = cols.col) AS column_names,
  (SELECT array_agg(a.attname ORDER BY ord) FROM unnest(c.confkey) WITH ORDINALITY AS cols(col, ord) JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = cols.col) AS referenced_column_names
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
WHERE c.contype = 'f'
  AND (
    n.nspname = 'public'
    OR (n.nspname = 'auth' AND cl.relname = 'users')
  );
`;
