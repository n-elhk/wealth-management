import {
  AssocieSaisieSchema,
  BienSaisieSchema,
  ProfilBailleurSaisieSchema,
  SocieteSaisieSchema,
  valider,
  type Associe,
  type Bien,
  type Detenteur,
  type ID,
  type ProfilBailleur,
  type Societe,
} from '@wealth-management/core';
import type { z } from 'zod';
import { Table, valeurSql } from '../crud.js';
import type { SqlDriver } from '../driver.js';

// ---------------------------------------------------------------------------
// Profil du bailleur (nom propre)
// ---------------------------------------------------------------------------

export class ProfilRepo {
  constructor(private readonly db: SqlDriver) {}

  async obtenir(): Promise<ProfilBailleur | null> {
    const rows = await this.db.select<ProfilBailleur>('SELECT * FROM profil_bailleur WHERE id = 1');
    return rows[0] ?? null;
  }

  async enregistrer(data: z.input<typeof ProfilBailleurSaisieSchema>): Promise<void> {
    const valide = valider(ProfilBailleurSaisieSchema, data);
    const cols = (Object.keys(ProfilBailleurSaisieSchema.shape) as (keyof typeof valide)[]).filter((c) => c in data);
    const vals = cols.map((c) => valeurSql(valide[c]));
    await this.db.execute(
      `INSERT INTO profil_bailleur (id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = datetime('now')`,
      vals,
    );
  }
}

// ---------------------------------------------------------------------------
// Sociétés & associés
// ---------------------------------------------------------------------------

export interface SocieteResume extends Societe {
  nb_biens: number;
  parts_attribuees: number;
}

export class SocietesRepo extends Table<typeof SocieteSaisieSchema, Societe> {
  readonly associes: Table<typeof AssocieSaisieSchema, Associe>;

  constructor(db: SqlDriver) {
    super(db, 'societe', SocieteSaisieSchema, 'raison_sociale COLLATE NOCASE');
    this.associes = new Table(db, 'associe', AssocieSaisieSchema, 'nombre_parts DESC');
  }

  listerResumes(): Promise<SocieteResume[]> {
    return this.db.select<SocieteResume>(`
      SELECT s.*,
        (SELECT COUNT(*) FROM bien b WHERE b.societe_id = s.id) AS nb_biens,
        (SELECT COALESCE(SUM(a.nombre_parts), 0) FROM associe a WHERE a.societe_id = s.id) AS parts_attribuees
      FROM societe s
      ORDER BY s.raison_sociale COLLATE NOCASE`);
  }

  listerAssocies(societeId: ID): Promise<Associe[]> {
    return this.db.select<Associe>(
      'SELECT * FROM associe WHERE societe_id = ? ORDER BY nombre_parts DESC, nom COLLATE NOCASE',
      [societeId],
    );
  }

  override async supprimer(id: ID): Promise<void> {
    const rows = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM bien WHERE societe_id = ?', [id]);
    const n = rows[0]?.n ?? 0;
    if (n > 0) throw new Error(`Impossible de supprimer : ${n} bien(s) sont rattachés à cette société.`);
    await super.supprimer(id);
  }
}

// ---------------------------------------------------------------------------
// Biens
// ---------------------------------------------------------------------------

export interface BienResume extends Bien {
  societe_nom: string | null;
  bail_actif_id: ID | null;
  loyer_actuel: number | null;
  locataires_actuels: string | null;
}

export interface FiltreBiens {
  detenteur?: Detenteur;
  societeId?: ID;
}

type SaisieBien = z.input<typeof BienSaisieSchema>;

/** Un bien détenu en nom propre n'a pas de société (la présence de la société est vérifiée par le schéma). */
function normaliserDetention<T extends Partial<SaisieBien>>(data: T): T {
  return data.detenteur === 'personnel' ? { ...data, societe_id: null } : data;
}

export class BiensRepo extends Table<typeof BienSaisieSchema, Bien> {
  constructor(db: SqlDriver) {
    super(db, 'bien', BienSaisieSchema, 'libelle COLLATE NOCASE');
  }

  override async creer(data: SaisieBien): Promise<ID> {
    return super.creer(normaliserDetention(data));
  }

  override async modifier(id: ID, data: Partial<SaisieBien>): Promise<void> {
    return super.modifier(id, normaliserDetention(data));
  }

  listerResumes(filtre: FiltreBiens = {}): Promise<BienResume[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filtre.detenteur) {
      where.push('b.detenteur = ?');
      params.push(filtre.detenteur);
    }
    if (filtre.societeId) {
      where.push('b.societe_id = ?');
      params.push(filtre.societeId);
    }
    return this.db.select<BienResume>(
      `SELECT b.*,
        s.raison_sociale AS societe_nom,
        ba.id AS bail_actif_id,
        CASE WHEN ba.id IS NULL THEN NULL ELSE ba.loyer_hc + ba.charges END AS loyer_actuel,
        (SELECT group_concat(l.prenom || ' ' || l.nom, ', ')
           FROM bail_locataire bl JOIN locataire l ON l.id = bl.locataire_id
          WHERE bl.bail_id = ba.id) AS locataires_actuels
      FROM bien b
      LEFT JOIN societe s ON s.id = b.societe_id
      LEFT JOIN bail ba ON ba.id = (
        SELECT id FROM bail WHERE bien_id = b.id AND statut = 'actif' ORDER BY date_debut DESC LIMIT 1)
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY b.libelle COLLATE NOCASE`,
      params,
    );
  }

  override async supprimer(id: ID): Promise<void> {
    const rows = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM bail WHERE bien_id = ?', [id]);
    if ((rows[0]?.n ?? 0) > 0) {
      throw new Error('Impossible de supprimer un bien ayant des baux (historique). Supprimez d’abord les baux.');
    }
    await super.supprimer(id);
  }
}
