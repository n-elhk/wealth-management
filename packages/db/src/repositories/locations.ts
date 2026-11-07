import {
  BailLocataireSchema,
  BailSaisieSchema,
  EcheanceSaisieSchema,
  GarantSaisieSchema,
  LocataireSaisieSchema,
  PaiementSaisieSchema,
  RevisionLoyerSaisieSchema,
  calculerEcheances,
  valider,
  dernierJour,
  periodeDe,
  resteDu,
  type Bail,
  type BailLocataire,
  type Bien,
  type Echeance,
  type Garant,
  type ID,
  type ISODate,
  type Locataire,
  type Paiement,
  type Periode,
  type RevisionLoyer,
  type RoleLocataire,
  type StatutBail,
} from '@wealth-management/core';
import { Table } from '../crud.js';
import type { SqlDriver } from '../driver.js';

// ---------------------------------------------------------------------------
// Locataires
// ---------------------------------------------------------------------------

export interface LocataireResume extends Locataire {
  nb_baux: number;
  bien_actuel: string | null;
  bail_actif_id: ID | null;
}

export class LocatairesRepo extends Table<typeof LocataireSaisieSchema, Locataire> {
  constructor(db: SqlDriver) {
    super(db, 'locataire', LocataireSaisieSchema, 'nom COLLATE NOCASE, prenom COLLATE NOCASE');
  }

  listerResumes(): Promise<LocataireResume[]> {
    return this.db.select<LocataireResume>(`
      SELECT l.*,
        (SELECT COUNT(*) FROM bail_locataire bl WHERE bl.locataire_id = l.id) AS nb_baux,
        (SELECT ba.id FROM bail_locataire bl JOIN bail ba ON ba.id = bl.bail_id
          WHERE bl.locataire_id = l.id AND ba.statut = 'actif' ORDER BY ba.date_debut DESC LIMIT 1) AS bail_actif_id,
        (SELECT b.libelle FROM bail_locataire bl JOIN bail ba ON ba.id = bl.bail_id JOIN bien b ON b.id = ba.bien_id
          WHERE bl.locataire_id = l.id AND ba.statut = 'actif' ORDER BY ba.date_debut DESC LIMIT 1) AS bien_actuel
      FROM locataire l
      ORDER BY l.nom COLLATE NOCASE, l.prenom COLLATE NOCASE`);
  }

  override async supprimer(id: ID): Promise<void> {
    const rows = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM bail_locataire WHERE locataire_id = ?', [id]);
    if ((rows[0]?.n ?? 0) > 0) {
      throw new Error('Ce locataire figure sur au moins un bail : il est conservé pour l’historique.');
    }
    await super.supprimer(id);
  }
}

// ---------------------------------------------------------------------------
// Baux
// ---------------------------------------------------------------------------

export interface BailResume extends Bail {
  bien_libelle: string;
  bien_ville: string | null;
  detenteur: Bien['detenteur'];
  societe_nom: string | null;
  locataires_noms: string | null;
}

export type LocataireDuBail = Locataire & { role: RoleLocataire };

export interface BailComplet {
  bail: Bail;
  bien: Bien;
  locataires: LocataireDuBail[];
  garants: Garant[];
  revisions: RevisionLoyer[];
}

export interface FiltreBaux {
  bienId?: ID;
  locataireId?: ID;
  statut?: StatutBail;
}

export class BauxRepo extends Table<typeof BailSaisieSchema, Bail> {
  readonly garants: Table<typeof GarantSaisieSchema, Garant>;

  constructor(db: SqlDriver) {
    super(db, 'bail', BailSaisieSchema, 'date_debut DESC');
    this.garants = new Table(db, 'garant', GarantSaisieSchema, 'id');
  }

  listerResumes(filtre: FiltreBaux = {}): Promise<BailResume[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filtre.bienId) {
      where.push('ba.bien_id = ?');
      params.push(filtre.bienId);
    }
    if (filtre.locataireId) {
      where.push('EXISTS (SELECT 1 FROM bail_locataire x WHERE x.bail_id = ba.id AND x.locataire_id = ?)');
      params.push(filtre.locataireId);
    }
    if (filtre.statut) {
      where.push('ba.statut = ?');
      params.push(filtre.statut);
    }
    return this.db.select<BailResume>(
      `SELECT ba.*,
        b.libelle AS bien_libelle, b.ville AS bien_ville, b.detenteur,
        s.raison_sociale AS societe_nom,
        (SELECT group_concat(l.prenom || ' ' || l.nom, ', ')
           FROM bail_locataire bl JOIN locataire l ON l.id = bl.locataire_id
          WHERE bl.bail_id = ba.id) AS locataires_noms
      FROM bail ba
      JOIN bien b ON b.id = ba.bien_id
      LEFT JOIN societe s ON s.id = b.societe_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE ba.statut WHEN 'actif' THEN 0 WHEN 'brouillon' THEN 1 ELSE 2 END, ba.date_debut DESC`,
      params,
    );
  }

  listerLocataires(bailId: ID): Promise<LocataireDuBail[]> {
    return this.db.select<LocataireDuBail>(
      `SELECT l.*, bl.role FROM bail_locataire bl JOIN locataire l ON l.id = bl.locataire_id
       WHERE bl.bail_id = ? ORDER BY CASE bl.role WHEN 'titulaire' THEN 0 ELSE 1 END, l.nom`,
      [bailId],
    );
  }

  listerGarants(bailId: ID): Promise<Garant[]> {
    return this.db.select<Garant>('SELECT * FROM garant WHERE bail_id = ? ORDER BY id', [bailId]);
  }

  listerRevisions(bailId: ID): Promise<RevisionLoyer[]> {
    return this.db.select<RevisionLoyer>('SELECT * FROM revision_loyer WHERE bail_id = ? ORDER BY date_effet DESC', [bailId]);
  }

  async obtenirComplet(id: ID): Promise<BailComplet | null> {
    const bail = await this.obtenir(id);
    if (!bail) return null;
    const [biens, locataires, garants, revisions] = await Promise.all([
      this.db.select<Bien>('SELECT * FROM bien WHERE id = ?', [bail.bien_id]),
      this.listerLocataires(id),
      this.listerGarants(id),
      this.listerRevisions(id),
    ]);
    return { bail, bien: biens[0]!, locataires, garants, revisions };
  }

  /** Remplace la liste des locataires d'un bail. */
  async definirLocataires(bailId: ID, locataires: Omit<BailLocataire, 'bail_id'>[]): Promise<void> {
    const valides = locataires.map((l) => valider(BailLocataireSchema, { ...l, bail_id: bailId }));
    await this.db.execute('DELETE FROM bail_locataire WHERE bail_id = ?', [bailId]);
    for (const l of valides) {
      await this.db.execute('INSERT INTO bail_locataire (bail_id, locataire_id, role) VALUES (?, ?, ?)', [
        bailId,
        l.locataire_id,
        l.role,
      ]);
    }
  }

  /** Vérifie qu'aucun autre bail actif n'occupe le bien sur la même période. */
  async verifierChevauchement(bail: Pick<Bail, 'bien_id' | 'statut'> & { id?: ID }): Promise<void> {
    if (bail.statut !== 'actif') return;
    const rows = await this.db.select<{ id: ID; reference: string | null }>(
      `SELECT id, reference FROM bail WHERE bien_id = ? AND statut = 'actif' AND id <> ?`,
      [bail.bien_id, bail.id ?? -1],
    );
    if (rows.length) {
      throw new Error(
        `Ce bien a déjà un bail en cours (${rows[0]!.reference ?? `#${rows[0]!.id}`}). Terminez-le avant d’en activer un nouveau.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Échéances, paiements, révisions
// ---------------------------------------------------------------------------

export interface EcheanceSuivi extends Echeance {
  total_paye: number;
  nb_paiements: number;
}

export interface EcheanceDetaillee extends EcheanceSuivi {
  bien_id: ID;
  bien_libelle: string;
  locataires_noms: string | null;
  statut_bail: StatutBail;
}

const SELECT_SUIVI = `
  e.*,
  COALESCE((SELECT SUM(p.montant) FROM paiement p WHERE p.echeance_id = e.id), 0) AS total_paye,
  (SELECT COUNT(*) FROM paiement p WHERE p.echeance_id = e.id) AS nb_paiements`;

const SELECT_DETAILLE = `${SELECT_SUIVI},
  ba.bien_id, ba.statut AS statut_bail, b.libelle AS bien_libelle,
  (SELECT group_concat(l.prenom || ' ' || l.nom, ', ')
     FROM bail_locataire bl JOIN locataire l ON l.id = bl.locataire_id WHERE bl.bail_id = ba.id) AS locataires_noms`;

export class LoyersRepo {
  readonly echeances: Table<typeof EcheanceSaisieSchema, Echeance>;
  readonly paiements: Table<typeof PaiementSaisieSchema, Paiement>;

  constructor(private readonly db: SqlDriver) {
    this.echeances = new Table(db, 'echeance', EcheanceSaisieSchema, 'periode DESC');
    this.paiements = new Table(db, 'paiement', PaiementSaisieSchema, 'date_paiement DESC');
  }

  /**
   * Crée les échéances manquantes d'un bail jusqu'à la fin du mois de `aLaDate`,
   * supprime les échéances non payées devenues hors période (sortie anticipée)
   * et recalcule le prorata des échéances non payées dont les bornes ont changé.
   */
  async synchroniser(bail: Bail, aLaDate: ISODate): Promise<void> {
    if (bail.statut === 'brouillon') {
      await this.db.execute(
        'DELETE FROM echeance WHERE bail_id = ? AND NOT EXISTS (SELECT 1 FROM paiement p WHERE p.echeance_id = echeance.id)',
        [bail.id],
      );
      return;
    }
    const calculees = calculerEcheances(bail, dernierJour(periodeDe(aLaDate)));
    const existantes = await this.listerParBail(bail.id);
    const parPeriode = new Map(existantes.map((e) => [e.periode, e]));
    const attendues = new Set(calculees.map((c) => c.periode));

    for (const c of calculees) {
      const e = parPeriode.get(c.periode);
      if (!e) {
        await this.echeances.creer(c);
      } else if (
        e.nb_paiements === 0 &&
        (e.date_debut_periode !== c.date_debut_periode || e.date_fin_periode !== c.date_fin_periode)
      ) {
        await this.echeances.modifier(e.id, c);
      }
    }
    for (const e of existantes) {
      if (!attendues.has(e.periode) && e.nb_paiements === 0) await this.echeances.supprimer(e.id);
    }
  }

  /** Supprime les échéances non payées à partir d'une période puis les régénère (après changement de loyer). */
  async recalculer(bail: Bail, aPartirDe: Periode, aLaDate: ISODate): Promise<void> {
    await this.db.execute(
      `DELETE FROM echeance WHERE bail_id = ? AND periode >= ?
         AND NOT EXISTS (SELECT 1 FROM paiement p WHERE p.echeance_id = echeance.id)`,
      [bail.id, aPartirDe],
    );
    await this.synchroniser(bail, aLaDate);
  }

  async synchroniserTout(aLaDate: ISODate): Promise<void> {
    const baux = await this.db.select<Bail>(`SELECT * FROM bail WHERE statut IN ('actif', 'termine')`);
    for (const b of baux) await this.synchroniser(b, aLaDate);
  }

  listerParBail(bailId: ID): Promise<EcheanceSuivi[]> {
    return this.db.select<EcheanceSuivi>(
      `SELECT ${SELECT_SUIVI} FROM echeance e WHERE e.bail_id = ? ORDER BY e.periode DESC`,
      [bailId],
    );
  }

  listerParPeriode(periode: Periode): Promise<EcheanceDetaillee[]> {
    return this.db.select<EcheanceDetaillee>(
      `SELECT ${SELECT_DETAILLE}
       FROM echeance e JOIN bail ba ON ba.id = e.bail_id JOIN bien b ON b.id = ba.bien_id
       WHERE e.periode = ? ORDER BY b.libelle COLLATE NOCASE`,
      [periode],
    );
  }

  /** Échéances exigibles à la date donnée et non intégralement réglées. */
  listerImpayes(aLaDate: ISODate): Promise<EcheanceDetaillee[]> {
    return this.db.select<EcheanceDetaillee>(
      `SELECT * FROM (
         SELECT ${SELECT_DETAILLE}
         FROM echeance e JOIN bail ba ON ba.id = e.bail_id JOIN bien b ON b.id = ba.bien_id
         WHERE e.date_echeance <= ?
       ) WHERE ROUND(total_paye, 2) < ROUND(loyer + charges, 2)
       ORDER BY date_echeance`,
      [aLaDate],
    );
  }

  listerPaiements(echeanceId: ID): Promise<Paiement[]> {
    return this.db.select<Paiement>('SELECT * FROM paiement WHERE echeance_id = ? ORDER BY date_paiement', [echeanceId]);
  }

  /**
   * Enregistre un paiement couvrant exactement le reste dû de l'échéance.
   * Sans `mode` explicite, le mode de paiement habituel du bail est utilisé.
   */
  async solder(echeanceId: ID, datePaiement: ISODate, mode?: Paiement['mode']): Promise<ID | null> {
    const rows = await this.db.select<EcheanceSuivi & { mode_paiement_bail: Paiement['mode'] }>(
      `SELECT ${SELECT_SUIVI}, ba.mode_paiement AS mode_paiement_bail
       FROM echeance e JOIN bail ba ON ba.id = e.bail_id WHERE e.id = ?`,
      [echeanceId],
    );
    const e = rows[0];
    if (!e) throw new Error(`Échéance #${echeanceId} introuvable`);
    const reste = resteDu(e, e.total_paye);
    if (reste <= 0) return null;
    return this.paiements.creer({
      echeance_id: echeanceId,
      date_paiement: datePaiement,
      montant: reste,
      mode: mode === undefined ? e.mode_paiement_bail : mode,
    });
  }

  async appliquerRevision(
    bail: Bail,
    revision: Pick<RevisionLoyer, 'date_effet' | 'nouveau_loyer' | 'irl_trimestre' | 'irl_nouveau' | 'notes'>,
    aLaDate: ISODate,
  ): Promise<void> {
    const r = valider(RevisionLoyerSaisieSchema, {
      ...revision,
      bail_id: bail.id,
      ancien_loyer: bail.loyer_hc,
      irl_ancien: bail.irl_valeur_reference,
    });
    await this.db.execute(
      `INSERT INTO revision_loyer (bail_id, date_effet, ancien_loyer, nouveau_loyer, irl_trimestre, irl_ancien, irl_nouveau, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.bail_id, r.date_effet, r.ancien_loyer, r.nouveau_loyer, r.irl_trimestre, r.irl_ancien, r.irl_nouveau, r.notes],
    );
    const maj: Partial<Bail> = { ...bail, loyer_hc: r.nouveau_loyer };
    if (r.irl_nouveau) maj.irl_valeur_reference = r.irl_nouveau;
    if (r.irl_trimestre) maj.irl_trimestre_reference = r.irl_trimestre;
    await this.db.execute(
      `UPDATE bail SET loyer_hc = ?, irl_valeur_reference = ?, irl_trimestre_reference = ?, updated_at = datetime('now') WHERE id = ?`,
      [maj.loyer_hc, maj.irl_valeur_reference ?? null, maj.irl_trimestre_reference ?? null, bail.id],
    );
    await this.recalculer({ ...bail, ...maj } as Bail, periodeDe(revision.date_effet), aLaDate);
  }
}
