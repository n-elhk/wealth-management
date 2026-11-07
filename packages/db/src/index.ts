import type { SqlDriver } from './driver.js';
import { migrer } from './migrations.js';
import { BauxRepo, LocatairesRepo, LoyersRepo } from './repositories/locations.js';
import { BiensRepo, ProfilRepo, SocietesRepo } from './repositories/patrimoine.js';
import { StatistiquesRepo } from './repositories/statistiques.js';

export type { SqlDriver } from './driver.js';
export { MIGRATIONS, migrer, type Migration } from './migrations.js';
export { Table, valeurSql, type Ligne } from './crud.js';
export * from './repositories/patrimoine.js';
export * from './repositories/locations.js';
export * from './repositories/statistiques.js';

export interface Depot {
  profil: ProfilRepo;
  societes: SocietesRepo;
  biens: BiensRepo;
  locataires: LocatairesRepo;
  baux: BauxRepo;
  loyers: LoyersRepo;
  statistiques: StatistiquesRepo;
}

export function creerDepot(db: SqlDriver): Depot {
  return {
    profil: new ProfilRepo(db),
    societes: new SocietesRepo(db),
    biens: new BiensRepo(db),
    locataires: new LocatairesRepo(db),
    baux: new BauxRepo(db),
    loyers: new LoyersRepo(db),
    statistiques: new StatistiquesRepo(db),
  };
}

/** Applique les migrations puis retourne le dépôt de données. */
export async function ouvrirDepot(db: SqlDriver): Promise<Depot> {
  await migrer(db);
  return creerDepot(db);
}
