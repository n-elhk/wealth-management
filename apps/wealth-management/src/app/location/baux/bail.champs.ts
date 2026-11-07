import { OPTIONS, type Option } from '@wealth-management/core';
import type { Champ } from '../../ui/fiche/champ';

const habitation = (v: Record<string, unknown>) =>
  ['habitation_vide', 'habitation_meuble', 'etudiant', 'mobilite'].includes(v['type_bail'] as string);

/** Fiche de détail d'un bail (lecture seule, `app-fiche`). Le formulaire de saisie est écrit dans sa page (Signal Forms). */
export function champsBail(biens: Option<number>[]): Champ[] {
  const g = 'Bail';
  const f = 'Conditions financières';
  const p = 'Paiement';
  const r = 'Révision & encadrement';
  return [
    { cle: 'bien_id', libelle: 'Bien loué', type: 'select', options: biens, section: g, largeur: 3 },
    { cle: 'type_bail', libelle: 'Type de bail', type: 'select', options: OPTIONS.typeBail, section: g, largeur: 3 },
    { cle: 'reference', libelle: 'Référence', type: 'texte', section: g, largeur: 2 },
    { cle: 'statut', libelle: 'Statut', type: 'select', options: OPTIONS.statutBail, section: g, largeur: 2 },
    { cle: 'date_signature', libelle: 'Date de signature', type: 'date', section: g, largeur: 2 },
    { cle: 'date_debut', libelle: 'Date de prise d’effet', type: 'date', section: g, largeur: 2 },
    { cle: 'duree_mois', libelle: 'Durée', type: 'nombre', section: g, largeur: 2, suffixe: 'mois' },
    { cle: 'tacite_reconduction', libelle: 'Tacite reconduction', type: 'case', section: g, largeur: 2 },
    {
      cle: 'destination', libelle: 'Destination des locaux', type: 'texte', section: g, largeur: 6,
    },
    { cle: 'date_sortie', libelle: 'Date de sortie', type: 'date', section: g, largeur: 2, visible: (v) => v['statut'] === 'termine' },
    { cle: 'motif_sortie', libelle: 'Motif de sortie', type: 'texte', section: g, largeur: 4, visible: (v) => v['statut'] === 'termine' },

    { cle: 'loyer_hc', libelle: 'Loyer hors charges', type: 'montant', section: f, largeur: 2 },
    { cle: 'charges', libelle: 'Charges', type: 'montant', section: f, largeur: 2 },
    { cle: 'mode_charges', libelle: 'Mode des charges', type: 'select', options: OPTIONS.modeCharges, section: f, largeur: 2 },
    { cle: 'depot_garantie', libelle: 'Dépôt de garantie', type: 'montant', section: f, largeur: 2 },

    { cle: 'jour_paiement', libelle: 'Jour de paiement', type: 'nombre', section: p, largeur: 2 },
    { cle: 'paiement_terme', libelle: 'Terme', type: 'select', options: OPTIONS.termePaiement, section: p, largeur: 2 },
    { cle: 'mode_paiement', libelle: 'Mode de paiement', type: 'select', options: OPTIONS.modePaiement, section: p, largeur: 2 },

    { cle: 'irl_trimestre_reference', libelle: 'Trimestre IRL de référence', type: 'texte', section: r, largeur: 2, visible: habitation },
    { cle: 'irl_valeur_reference', libelle: 'Valeur IRL de référence', type: 'nombre', section: r, largeur: 2, visible: habitation },
    { cle: 'zone_tendue', libelle: 'Zone tendue / encadrement', type: 'case', section: r, largeur: 2, visible: habitation },
    { cle: 'loyer_reference_majore', libelle: 'Loyer de référence majoré', type: 'montant', section: r, largeur: 2, suffixe: '€/m²', visible: (v) => !!v['zone_tendue'] && habitation(v) },
    { cle: 'complement_loyer', libelle: 'Complément de loyer', type: 'montant', section: r, largeur: 2, visible: (v) => !!v['zone_tendue'] && habitation(v) },
    { cle: 'dernier_loyer_precedent', libelle: 'Loyer du locataire précédent', type: 'montant', section: r, largeur: 2, visible: (v) => !!v['zone_tendue'] && habitation(v) },

    { cle: 'clauses_particulieres', libelle: 'Clauses particulières', type: 'zone', section: 'Clauses & notes', largeur: 6 },
    { cle: 'notes', libelle: 'Notes internes (non imprimées)', type: 'zone', section: 'Clauses & notes', largeur: 6 },
  ];
}
