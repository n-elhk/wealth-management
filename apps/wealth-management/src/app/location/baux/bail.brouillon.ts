import { DUREE_DEFAUT_BAIL, aujourdhui, type Bail, type RoleLocataire, type TypeBail } from '@wealth-management/core';
import { textes } from '../../ui/formulaire/saisie';

/** Champs texte du formulaire de bail (les cases à cocher sont à part). */
export const CLES_BAIL = [
  'bien_id', 'type_bail', 'reference', 'statut', 'date_signature', 'date_debut', 'duree_mois', 'destination',
  'date_sortie', 'motif_sortie', 'loyer_hc', 'charges', 'mode_charges', 'depot_garantie',
  'jour_paiement', 'paiement_terme', 'mode_paiement',
  'irl_trimestre_reference', 'irl_valeur_reference', 'loyer_reference_majore', 'complement_loyer', 'dernier_loyer_precedent',
  'clauses_particulieres', 'notes',
] as const;

/** Modèle du formulaire de bail : des chaînes pour les champs, des booléens pour les cases. */
export type ModeleBail = Record<(typeof CLES_BAIL)[number], string> & { tacite_reconduction: boolean; zone_tendue: boolean };

/**
 * Saisie de bail en attente, reprise une seule fois par le formulaire : conservée pendant la création
 * d'un locataire depuis le formulaire, ou produite par l'import d'un contrat PDF.
 */
export interface BrouillonBail {
  modele: ModeleBail;
  roles: [number, RoleLocataire][];
}

export function cleBrouillonBail(id: number | null) {
  return `bail:${id ?? 'nouveau'}`;
}

type ValeursBail = { [K in keyof Bail]?: Bail[K] | null };

/** Modèle d'un nouveau bail : valeurs par défaut du type de bail, complétées par `valeurs` (les `null` sont ignorés). */
export function modeleNouveauBail(valeurs: ValeursBail = {}): ModeleBail {
  const renseignees = Object.fromEntries(Object.entries(valeurs).filter(([, v]) => v !== null && v !== undefined)) as ValeursBail;
  const type: TypeBail = renseignees.type_bail ?? 'habitation_vide';
  const v: ValeursBail = {
    type_bail: type,
    statut: 'actif',
    date_debut: aujourdhui(),
    date_signature: aujourdhui(),
    duree_mois: DUREE_DEFAUT_BAIL[type],
    charges: 0,
    mode_charges: 'provision',
    depot_garantie: 0,
    jour_paiement: 1,
    paiement_terme: 'echoir',
    mode_paiement: 'virement',
    ...renseignees,
  };
  return {
    ...textes(CLES_BAIL, v),
    tacite_reconduction: v.tacite_reconduction === undefined ? type !== 'mobilite' && type !== 'etudiant' : !!v.tacite_reconduction,
    zone_tendue: !!v.zone_tendue,
  };
}
