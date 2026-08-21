import { getDb } from "./connection";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Run a block of database operations inside a transaction. If the block throws,
 * the transaction is rolled back automatically. The callback receives a Drizzle
 * transaction object that should be used for every query in the block.
 *
 * Use this whenever a mutation touches more than one table and partial writes
 * would leave the system in an inconsistent state.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(fn);
}
