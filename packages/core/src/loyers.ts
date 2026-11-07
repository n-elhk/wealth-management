import {
  ajouterJours,
  ajouterMois,
  dernierJour,
  joursDansMois,
  joursInclus,
  maxDate,
  minDate,
  parsePeriode,
  periodeDe,
  periodeSuivante,
  premierJour,
  toISO,
} from './dates.js';
import { arrondi } from './montants.js';
import type { Bail, Echeance, ISODate, Nouveau, Periode, StatutEcheance } from './schemas.js';

/** Date de fin contractuelle (date de début + durée − 1 jour). */
export function dateFinContractuelle(bail: Pick<Bail, 'date_debut' | 'duree_mois'>): ISODate {
  return ajouterJours(ajouterMois(bail.date_debut, bail.duree_mois), -1);
}

/**
 * Date de fin effective à prendre en compte pour les loyers :
 * la date de sortie si elle est connue, sinon la fin contractuelle
 * (sauf tacite reconduction, auquel cas le bail court indéfiniment).
 */
export function dateFinEffective(
  bail: Pick<Bail, 'date_debut' | 'duree_mois' | 'date_sortie' | 'tacite_reconduction'>,
): ISODate | null {
  if (bail.date_sortie) return bail.date_sortie;
  if (bail.tacite_reconduction) return null;
  return dateFinContractuelle(bail);
}

export type EcheanceCalculee = Omit<Nouveau<Echeance>, 'notes'>;

/**
 * Calcule les échéances mensuelles d'un bail jusqu'au mois de `jusquA` inclus.
 * Les premier et dernier mois sont proratisés au nombre de jours d'occupation.
 */
export function calculerEcheances(
  bail: Pick<
    Bail,
    'id' | 'date_debut' | 'duree_mois' | 'date_sortie' | 'tacite_reconduction' | 'loyer_hc' | 'charges' | 'jour_paiement' | 'paiement_terme'
  >,
  jusquA: ISODate,
): EcheanceCalculee[] {
  const fin = dateFinEffective(bail);
  const derniere: Periode = fin ? periodeDe(minDate(fin, jusquA)) : periodeDe(jusquA);
  const result: EcheanceCalculee[] = [];

  for (let p = periodeDe(bail.date_debut); p <= derniere; p = periodeSuivante(p)) {
    const debutMois = premierJour(p);
    const finMois = dernierJour(p);
    const debut = maxDate(debutMois, bail.date_debut);
    const finPeriode = fin ? minDate(finMois, fin) : finMois;
    if (finPeriode < debut) continue;

    const { y, m } = parsePeriode(p);
    const ratio = joursInclus(debut, finPeriode) / joursDansMois(y, m);
    const jour = Math.min(Math.max(1, bail.jour_paiement || 1), joursDansMois(y, m));

    result.push({
      bail_id: bail.id,
      periode: p,
      date_echeance: bail.paiement_terme === 'echu' ? finMois : maxDate(toISO(y, m, jour), debut),
      date_debut_periode: debut,
      date_fin_periode: finPeriode,
      loyer: arrondi(bail.loyer_hc * ratio),
      charges: arrondi(bail.charges * ratio),
    });
  }
  return result;
}

export function totalEcheance(e: Pick<Echeance, 'loyer' | 'charges'>): number {
  return arrondi(e.loyer + e.charges);
}

/** Reste dû sur une échéance, arrondi au centime (négatif en cas de trop-perçu). */
export function resteDu(e: Pick<Echeance, 'loyer' | 'charges'>, totalPaye: number): number {
  return arrondi(totalEcheance(e) - totalPaye);
}

export function statutEcheance(
  e: Pick<Echeance, 'loyer' | 'charges' | 'date_echeance'>,
  totalPaye: number,
  aLaDate: ISODate,
): StatutEcheance {
  const du = totalEcheance(e);
  const paye = arrondi(totalPaye);
  if (paye > du) return 'trop_percu';
  if (paye === du) return 'payee';
  if (e.date_echeance > aLaDate) return paye > 0 ? 'partielle' : 'a_venir';
  return paye > 0 ? 'partielle' : 'en_retard';
}

/**
 * Révision annuelle selon l'IRL : nouveau loyer = loyer × (IRL nouveau / IRL de référence).
 * La hausse ne peut pas dépasser la variation de l'indice.
 */
export function calculerRevisionIRL(loyerActuel: number, irlReference: number, irlNouveau: number): number {
  if (irlReference <= 0 || irlNouveau <= 0) throw new Error('Les indices IRL doivent être positifs');
  return arrondi((loyerActuel * irlNouveau) / irlReference);
}

/** Date anniversaire de la prochaine révision à partir de la date de début. */
export function prochaineDateRevision(dateDebut: ISODate, aLaDate: ISODate): ISODate {
  let d = ajouterMois(dateDebut, 12);
  while (d <= aLaDate) d = ajouterMois(d, 12);
  return d;
}

/** Dépôt de garantie maximal légal (loi du 6 juillet 1989). */
export function depotGarantieMaximum(typeBail: Bail['type_bail'], loyerHc: number): number | null {
  switch (typeBail) {
    case 'habitation_vide':
      return arrondi(loyerHc);
    case 'habitation_meuble':
    case 'etudiant':
      return arrondi(loyerHc * 2);
    case 'mobilite':
      return 0;
    default:
      return null;
  }
}
