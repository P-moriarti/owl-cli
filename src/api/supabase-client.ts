import { Client } from "pg";

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

/**
 * Validate Postgres connection string with SELECT 1.
 */
export async function validateConnectionString(
  connectionString: string
): Promise<boolean> {
  const client = new Client(buildSupabasePgConfig(connectionString));
  try {
    await client.connect();
    const result = await client.query("SELECT 1 AS ok");
    return result.rows[0]?.["ok"] === 1;
  } catch {
    return false;
  } finally {
    await client.end();
  }
}
