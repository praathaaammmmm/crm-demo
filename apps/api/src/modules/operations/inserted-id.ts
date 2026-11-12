/**
 * Operations inserts are raw SQL with explicit column lists: crm_app has INSERT on the listed columns only
 * (migration 0021), and a Drizzle insert names every column (sending DEFAULT for the rest), which the grants refuse.
 */
export function insertedId(rows: { id: string }[], what: string): string {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`${what} insert returned no row`);
  return id;
}
