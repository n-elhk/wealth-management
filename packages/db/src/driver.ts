/**
 * Abstraction minimale d'une connexion SQLite.
 * Compatible avec `Database` de `@tauri-apps/plugin-sql` (application)
 * et avec `node:sqlite` (tests).
 *
 * Les requêtes utilisent des paramètres positionnels `?`.
 */
export interface SqlDriver {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
