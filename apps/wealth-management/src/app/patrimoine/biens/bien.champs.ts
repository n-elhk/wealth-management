import { OPTIONS, type Option } from '@wealth-management/core';
import type { Champ } from '../../ui/fiche/champ';
import { champsAdresse } from '../adresse.champs';

/** Fiche de détail d'un bien (lecture seule, `app-fiche`). Le formulaire de saisie est écrit dans sa page (Signal Forms). */
export function champsBien(biens: Option<number>[]): Champ[] {
  const s = 'Général';
  const loc = 'Localisation dans l’immeuble';
  const car = 'Caractéristiques';
  const en = 'Énergie';
  const acq = 'Acquisition & charges';
  return [
    { cle: 'libelle', libelle: 'Nom du bien', type: 'texte', section: s, largeur: 4 },
    { cle: 'type_bien', libelle: 'Type', type: 'select', options: OPTIONS.typeBien, section: s, largeur: 2 },
    { cle: 'detenteur', libelle: 'Détention', type: 'select', options: OPTIONS.detenteur, section: s, largeur: 3 },
    {
      cle: 'societe_id', libelle: 'Société propriétaire', type: 'select', options: [], section: s, largeur: 3,
      visible: (v) => v['detenteur'] === 'societe',
    },
    { cle: 'parent_id', libelle: 'Rattaché à (immeuble…)', type: 'select', options: biens, section: s, largeur: 3 },
    { cle: 'meuble', libelle: 'Loué meublé', type: 'case', section: s, largeur: 3 },

    ...champsAdresse('Adresse'),

    { cle: 'batiment', libelle: 'Bâtiment', type: 'texte', section: loc, largeur: 2 },
    { cle: 'escalier', libelle: 'Escalier', type: 'texte', section: loc, largeur: 2 },
    { cle: 'etage', libelle: 'Étage', type: 'texte', section: loc, largeur: 2 },
    { cle: 'porte', libelle: 'Porte', type: 'texte', section: loc, largeur: 2 },
    { cle: 'numero_lot', libelle: 'N° de lot', type: 'texte', section: loc, largeur: 2 },
    { cle: 'tantiemes', libelle: 'Tantièmes', type: 'nombre', section: loc, largeur: 2, suffixe: '/1000' },
    { cle: 'regime_juridique', libelle: 'Régime juridique', type: 'select', options: OPTIONS.regimeJuridique, section: loc },
    { cle: 'lots_annexes', libelle: 'Lots annexes (cave, parking…)', type: 'texte', section: loc },
    { cle: 'parties_communes', libelle: 'Parties et équipements communs', type: 'zone', section: loc, largeur: 6 },

    { cle: 'surface_habitable', libelle: 'Surface habitable', type: 'nombre', section: car, largeur: 2, suffixe: 'm²' },
    { cle: 'surface_terrain', libelle: 'Surface du terrain', type: 'nombre', section: car, largeur: 2, suffixe: 'm²' },
    { cle: 'annee_construction', libelle: 'Année de construction', type: 'nombre', section: car, largeur: 2 },
    { cle: 'nb_pieces', libelle: 'Pièces principales', type: 'nombre', section: car, largeur: 2 },
    { cle: 'nb_chambres', libelle: 'Chambres', type: 'nombre', section: car, largeur: 2 },
    { cle: 'equipements', libelle: 'Équipements', type: 'zone', section: car, largeur: 6 },
    { cle: 'description', libelle: 'Description', type: 'zone', section: car, largeur: 6 },

    { cle: 'chauffage_mode', libelle: 'Chauffage', type: 'select', options: OPTIONS.modeChauffage, section: en, largeur: 2 },
    { cle: 'chauffage_energie', libelle: 'Énergie de chauffage', type: 'texte', section: en, largeur: 2 },
    { cle: 'eau_chaude_mode', libelle: 'Eau chaude', type: 'select', options: OPTIONS.modeChauffage, section: en, largeur: 2 },
    { cle: 'dpe_classe', libelle: 'Classe DPE', type: 'select', options: OPTIONS.classeEnergie, section: en, largeur: 2 },
    { cle: 'dpe_consommation', libelle: 'Consommation', type: 'nombre', section: en, largeur: 2, suffixe: 'kWh/m²/an' },
    { cle: 'ges_classe', libelle: 'Classe GES', type: 'select', options: OPTIONS.classeEnergie, section: en, largeur: 2 },

    { cle: 'date_acquisition', libelle: 'Date d’acquisition', type: 'date', section: acq, largeur: 2 },
    { cle: 'prix_acquisition', libelle: 'Prix d’acquisition', type: 'montant', section: acq, largeur: 2 },
    { cle: 'taxe_fonciere', libelle: 'Taxe foncière annuelle', type: 'montant', section: acq, largeur: 2 },
    { cle: 'charges_copro_annuelles', libelle: 'Charges de copropriété annuelles', type: 'montant', section: acq, largeur: 3 },
    { cle: 'notes', libelle: 'Notes', type: 'zone', section: acq, largeur: 6 },
  ];
}
