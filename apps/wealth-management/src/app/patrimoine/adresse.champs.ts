import type { Champ } from '../ui/fiche/champ';

/** Champs de l'adresse (siège d'une société, bien). */
export const champsAdresse = (section = 'Adresse'): Champ[] => [
  { cle: 'adresse_ligne1', libelle: 'Adresse', type: 'texte', section, largeur: 6 },
  { cle: 'adresse_ligne2', libelle: "Complément d'adresse", type: 'texte', section, largeur: 6 },
  { cle: 'code_postal', libelle: 'Code postal', type: 'texte', section, largeur: 2 },
  { cle: 'ville', libelle: 'Ville', type: 'texte', section, largeur: 2 },
  { cle: 'pays', libelle: 'Pays', type: 'texte', section, largeur: 2 },
];
