import { OPTIONS } from '@wealth-management/core';
import type { Champ } from '../../ui/fiche/champ';
import { champsAdresse } from '../adresse.champs';

/** Fiche de détail d'une société (lecture seule, `app-fiche`). Le formulaire de saisie est écrit dans sa page (Signal Forms). */
export const CHAMPS_SOCIETE: Champ[] = [
  { cle: 'raison_sociale', libelle: 'Raison sociale', type: 'texte', section: 'Identification', largeur: 4 },
  { cle: 'forme_juridique', libelle: 'Forme juridique', type: 'select', options: OPTIONS.formeJuridique, section: 'Identification', largeur: 2 },
  { cle: 'siren', libelle: 'SIREN', type: 'texte', section: 'Identification', largeur: 2 },
  { cle: 'rcs_ville', libelle: 'Greffe (RCS)', type: 'texte', section: 'Identification', largeur: 2 },
  { cle: 'date_creation', libelle: 'Date de création', type: 'date', section: 'Identification', largeur: 2 },
  { cle: 'objet_social', libelle: 'Objet social', type: 'zone', section: 'Identification', largeur: 6 },

  { cle: 'capital', libelle: 'Capital social', type: 'montant', section: 'Capital & fiscalité', largeur: 2 },
  { cle: 'nombre_parts', libelle: 'Nombre de parts', type: 'nombre', section: 'Capital & fiscalité', largeur: 2 },
  { cle: 'valeur_nominale_part', libelle: 'Valeur nominale d’une part', type: 'montant', section: 'Capital & fiscalité', largeur: 2 },
  { cle: 'regime_fiscal', libelle: 'Régime fiscal', type: 'select', options: OPTIONS.regimeFiscal, section: 'Capital & fiscalité' },
  { cle: 'date_cloture_exercice', libelle: 'Clôture de l’exercice', type: 'texte', section: 'Capital & fiscalité' },

  { cle: 'representant_nom', libelle: 'Représentant légal', type: 'texte', section: 'Représentation', largeur: 3 },
  { cle: 'representant_qualite', libelle: 'Qualité', type: 'texte', section: 'Représentation', largeur: 3 },
  { cle: 'email', libelle: 'E-mail', type: 'email', section: 'Représentation' },
  { cle: 'telephone', libelle: 'Téléphone', type: 'tel', section: 'Représentation' },
  { cle: 'iban', libelle: 'IBAN', type: 'texte', section: 'Représentation', largeur: 6 },

  ...champsAdresse('Siège social'),
  { cle: 'notes', libelle: 'Notes', type: 'zone', section: 'Notes', largeur: 6 },
];
