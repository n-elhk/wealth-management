import { OPTIONS } from '@wealth-management/core';
import type { Champ } from '../../ui/fiche/champ';

/** Fiche de détail d'un locataire (lecture seule, `app-fiche`). Le formulaire de saisie est écrit dans sa page (Signal Forms). */
export const CHAMPS_LOCATAIRE: Champ[] = [
  { cle: 'civilite', libelle: 'Civilité', type: 'select', options: OPTIONS.civilite, section: 'État civil', largeur: 2 },
  { cle: 'prenom', libelle: 'Prénom', type: 'texte', section: 'État civil', largeur: 2 },
  { cle: 'nom', libelle: 'Nom', type: 'texte', section: 'État civil', largeur: 2 },
  { cle: 'date_naissance', libelle: 'Date de naissance', type: 'date', section: 'État civil', largeur: 2 },
  { cle: 'lieu_naissance', libelle: 'Lieu de naissance', type: 'texte', section: 'État civil', largeur: 2 },
  { cle: 'nationalite', libelle: 'Nationalité', type: 'texte', section: 'État civil', largeur: 2 },
  { cle: 'situation_familiale', libelle: 'Situation familiale', type: 'texte', section: 'État civil' },
  { cle: 'type_piece_identite', libelle: 'Pièce d’identité', type: 'texte', section: 'État civil', largeur: 2 },
  { cle: 'numero_piece_identite', libelle: 'N° de pièce', type: 'texte', section: 'État civil', largeur: 2 },

  { cle: 'email', libelle: 'E-mail', type: 'email', section: 'Contact' },
  { cle: 'telephone', libelle: 'Téléphone', type: 'tel', section: 'Contact' },
  { cle: 'adresse_precedente', libelle: 'Adresse précédente', type: 'texte', section: 'Contact', largeur: 6 },

  { cle: 'profession', libelle: 'Profession', type: 'texte', section: 'Situation professionnelle', largeur: 2 },
  { cle: 'employeur', libelle: 'Employeur', type: 'texte', section: 'Situation professionnelle', largeur: 2 },
  { cle: 'revenus_mensuels', libelle: 'Revenus mensuels nets', type: 'montant', section: 'Situation professionnelle', largeur: 2 },
  { cle: 'notes', libelle: 'Notes', type: 'zone', section: 'Notes', largeur: 6 },
];
