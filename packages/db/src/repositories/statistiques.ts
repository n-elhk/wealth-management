import { periodeDe, type ISODate } from '@wealth-management/core';
import type { SqlDriver } from '../driver.js';

export interface TableauDeBord {
  nb_societes: number;
  nb_biens: number;
  nb_biens_loues: number;
  nb_baux_actifs: number;
  nb_locataires_actifs: number;
  mois_attendu: number;
  mois_encaisse: number;
  annee_encaisse: number;
  impayes_total: number;
  impayes_nb: number;
  /** Loyers attendus / encaissés sur les 12 derniers mois. */
  historique: { periode: string; attendu: number; encaisse: number }[];
}

export class StatistiquesRepo {
  constructor(private readonly db: SqlDriver) {}

  async tableauDeBord(aLaDate: ISODate): Promise<TableauDeBord> {
    const periode = periodeDe(aLaDate);
    const annee = aLaDate.slice(0, 4);
    const [compteurs] = await this.db.select<Omit<TableauDeBord, 'historique'>>(
      `SELECT
        (SELECT COUNT(*) FROM societe) AS nb_societes,
        (SELECT COUNT(*) FROM bien) AS nb_biens,
        (SELECT COUNT(DISTINCT bien_id) FROM bail WHERE statut = 'actif') AS nb_biens_loues,
        (SELECT COUNT(*) FROM bail WHERE statut = 'actif') AS nb_baux_actifs,
        (SELECT COUNT(DISTINCT bl.locataire_id) FROM bail_locataire bl JOIN bail b ON b.id = bl.bail_id
          WHERE b.statut = 'actif') AS nb_locataires_actifs,
        (SELECT COALESCE(SUM(loyer + charges), 0) FROM echeance WHERE periode = ?) AS mois_attendu,
        (SELECT COALESCE(SUM(p.montant), 0) FROM paiement p JOIN echeance e ON e.id = p.echeance_id
          WHERE e.periode = ?) AS mois_encaisse,
        (SELECT COALESCE(SUM(montant), 0) FROM paiement WHERE substr(date_paiement, 1, 4) = ?) AS annee_encaisse,
        (SELECT COALESCE(SUM(du - paye), 0) FROM (
           SELECT e.loyer + e.charges AS du,
             COALESCE((SELECT SUM(montant) FROM paiement p WHERE p.echeance_id = e.id), 0) AS paye
           FROM echeance e WHERE e.date_echeance <= ?) WHERE ROUND(paye, 2) < ROUND(du, 2)) AS impayes_total,
        (SELECT COUNT(*) FROM (
           SELECT e.loyer + e.charges AS du,
             COALESCE((SELECT SUM(montant) FROM paiement p WHERE p.echeance_id = e.id), 0) AS paye
           FROM echeance e WHERE e.date_echeance <= ?) WHERE ROUND(paye, 2) < ROUND(du, 2)) AS impayes_nb`,
      [periode, periode, annee, aLaDate, aLaDate],
    );

    const historique = await this.db.select<{ periode: string; attendu: number; encaisse: number }>(
      `SELECT e.periode,
        ROUND(SUM(e.loyer + e.charges), 2) AS attendu,
        ROUND(COALESCE(SUM((SELECT SUM(p.montant) FROM paiement p WHERE p.echeance_id = e.id)), 0), 2) AS encaisse
      FROM echeance e
      WHERE e.periode <= ?
      GROUP BY e.periode
      ORDER BY e.periode DESC
      LIMIT 12`,
      [periode],
    );

    return { ...compteurs!, historique: historique.reverse() };
  }
}
