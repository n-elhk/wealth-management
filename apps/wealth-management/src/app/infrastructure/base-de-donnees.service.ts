import { Service, signal } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { aujourdhui } from '@wealth-management/core';
import { ouvrirDepot, type Depot, type SqlDriver } from '@wealth-management/db';

/** Fichier SQLite, créé dans le répertoire de données de l'application (AppConfig). */
export const FICHIER_BDD = 'sqlite:wealth-management.db';

const TABLES_EXPORT = [
  'profil_bailleur', 'societe', 'associe', 'bien', 'locataire', 'bail', 'bail_locataire', 'garant',
  'revision_loyer', 'echeance', 'paiement',
] as const;

class TauriSqlDriver implements SqlDriver {
  constructor(private readonly db: Database) {}

  async execute(sql: string, params: unknown[] = []) {
    const r = await this.db.execute(sql, params);
    return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId };
  }

  select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.select<T[]>(sql, params);
  }
}

@Service()
export class BaseDeDonnees {
  private _depot: Depot | null = null;
  private driver: SqlDriver | null = null;

  readonly etat = signal<'chargement' | 'pret' | 'erreur'>('chargement');
  readonly erreur = signal<string | null>(null);

  /** Accès aux repositories (disponible après initialisation). */
  get depot(): Depot {
    if (!this._depot) throw new Error('Base de données non initialisée');
    return this._depot;
  }

  async initialiser(): Promise<void> {
    try {
      if (!isTauri()) {
        throw new Error(
          "L'application doit être lancée dans Tauri (pnpm dev) : SQLite n'est pas accessible depuis un simple navigateur.",
        );
      }
      const db = await Database.load(FICHIER_BDD);
      this.driver = new TauriSqlDriver(db);
      this._depot = await ouvrirDepot(this.driver);
      await this._depot.loyers.synchroniserTout(aujourdhui());
      this.etat.set('pret');
    } catch (e) {
      console.error(e);
      this.erreur.set(e instanceof Error ? e.message : String(e));
      this.etat.set('erreur');
    }
  }

  /** Sauvegarde complète au format JSON. */
  async exporter(): Promise<Record<string, unknown[]>> {
    if (!this.driver) throw new Error('Base de données non initialisée');
    const out: Record<string, unknown[]> = {};
    for (const t of TABLES_EXPORT) out[t] = await this.driver.select(`SELECT * FROM ${t}`);
    return out;
  }
}
