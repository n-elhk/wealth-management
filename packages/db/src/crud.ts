import { valider, type Horodatage, type ID } from '@wealth-management/core';
import type { z } from 'zod';
import type { SqlDriver } from './driver.js';

/** Normalise une valeur JS pour SQLite (undefined/'' → NULL, booléen → 0/1). */
export function valeurSql(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/** Ligne lue en base pour un schéma de saisie : données validées + id et horodatage. */
export type Ligne<S extends z.ZodObject> = z.output<S> & { id: ID } & Horodatage;

/**
 * CRUD générique sur une table, piloté par le schéma zod de saisie de l'entité :
 * - les colonnes écrites sont restreintes aux clés du schéma (protège contre l'injection de noms de colonnes) ;
 * - toute écriture est validée (et normalisée) par le schéma ; une modification partielle est validée
 *   fusionnée avec la ligne existante, pour que les règles inter-champs s'appliquent.
 */
export class Table<S extends z.ZodObject, T extends Ligne<S> = Ligne<S>> {
  readonly colonnes: readonly string[];

  constructor(
    protected readonly db: SqlDriver,
    readonly nom: string,
    readonly schema: S,
    protected readonly ordre = 'id DESC',
  ) {
    this.colonnes = Object.keys(schema.shape);
  }

  /** Colonnes fournies par l'appelant (les autres gardent leur valeur ou le défaut SQL) et leurs valeurs validées. */
  private filtrer(fournies: object, validees: Record<string, unknown>): [string[], unknown[]] {
    const cols = this.colonnes.filter((c) => c in fournies);
    return [cols, cols.map((c) => valeurSql(validees[c]))];
  }

  async lister(): Promise<T[]> {
    return this.db.select<T>(`SELECT * FROM ${this.nom} ORDER BY ${this.ordre}`);
  }

  async obtenir(id: ID): Promise<T | null> {
    const rows = await this.db.select<T>(`SELECT * FROM ${this.nom} WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async exiger(id: ID): Promise<T> {
    const row = await this.obtenir(id);
    if (!row) throw new Error(`${this.nom} #${id} introuvable`);
    return row;
  }

  async creer(data: z.input<S>): Promise<ID> {
    const validees = valider(this.schema, data) as Record<string, unknown>;
    const [cols, vals] = this.filtrer(data, validees);
    if (cols.length === 0) throw new Error(`Aucune donnée à insérer dans ${this.nom}`);
    const res = await this.db.execute(
      `INSERT INTO ${this.nom} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals,
    );
    if (res.lastInsertId === undefined || res.lastInsertId === null) {
      const rows = await this.db.select<{ id: ID }>('SELECT last_insert_rowid() AS id');
      return rows[0]!.id;
    }
    return Number(res.lastInsertId);
  }

  async modifier(id: ID, data: Partial<z.input<S>>): Promise<void> {
    if (!this.colonnes.some((c) => c in data)) return;
    const actuelle = await this.exiger(id);
    const validees = valider(this.schema, { ...actuelle, ...data }) as Record<string, unknown>;
    const [cols, vals] = this.filtrer(data, validees);
    await this.db.execute(
      `UPDATE ${this.nom} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...vals, id],
    );
  }

  async supprimer(id: ID): Promise<void> {
    await this.db.execute(`DELETE FROM ${this.nom} WHERE id = ?`, [id]);
  }
}
