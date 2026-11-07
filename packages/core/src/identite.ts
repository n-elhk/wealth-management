import { LIBELLES_FORME_JURIDIQUE } from './libelles.js';
import { formatEuro } from './montants.js';
import type { Adresse, Bien, Locataire, ProfilBailleur, Societe } from './schemas.js';

export function nomComplet(p: { civilite?: string | null; prenom?: string | null; nom?: string | null }, avecCivilite = false): string {
  return [avecCivilite ? p.civilite : null, p.prenom, p.nom?.toUpperCase()].filter(Boolean).join(' ');
}

export function formatAdresse(a: Partial<Adresse>, separateur = ', '): string {
  const villeLigne = [a.code_postal, a.ville].filter(Boolean).join(' ');
  return [a.adresse_ligne1, a.adresse_ligne2, villeLigne, a.pays && a.pays !== 'France' ? a.pays : null]
    .filter(Boolean)
    .join(separateur);
}

/** Localisation précise du bien (bâtiment, escalier, étage, porte, lot). */
export function localisationBien(b: Partial<Bien>): string {
  return [
    b.batiment && `bâtiment ${b.batiment}`,
    b.escalier && `escalier ${b.escalier}`,
    b.etage && (b.etage === '0' || /^rdc$/i.test(b.etage) ? 'rez-de-chaussée' : `étage ${b.etage}`),
    b.porte && `porte ${b.porte}`,
    b.numero_lot && `lot n° ${b.numero_lot}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Bailleur tel qu'il apparaît sur les documents. */
export interface IdentiteBailleur {
  type: 'personne' | 'societe';
  designation: string;
  adresse: string;
  details: string[];
  signataire: string;
}

export function identiteBailleur(profil: ProfilBailleur | null, societe: Societe | null): IdentiteBailleur {
  if (societe) {
    const forme = LIBELLES_FORME_JURIDIQUE[societe.forme_juridique] ?? societe.forme_juridique;
    const details = [
      `${forme}${societe.capital ? ` au capital de ${formatEuro(societe.capital)}` : ''}`,
      societe.siren ? `SIREN ${societe.siren}${societe.rcs_ville ? ` — RCS ${societe.rcs_ville}` : ''}` : null,
      societe.representant_nom
        ? `représentée par ${societe.representant_nom}${societe.representant_qualite ? `, ${societe.representant_qualite}` : ''}`
        : null,
    ].filter((x): x is string => !!x);
    return {
      type: 'societe',
      designation: societe.raison_sociale,
      adresse: formatAdresse(societe),
      details,
      signataire: societe.representant_nom
        ? `${societe.raison_sociale}, représentée par ${societe.representant_nom}`
        : societe.raison_sociale,
    };
  }
  const nom = profil ? nomComplet(profil, true) : '';
  return {
    type: 'personne',
    designation: nom || '[Bailleur — à compléter dans Paramètres]',
    adresse: profil ? formatAdresse(profil) : '',
    details: [],
    signataire: nom || 'Le bailleur',
  };
}

export function designationLocataires(locataires: Locataire[]): string {
  return locataires.map((l) => nomComplet(l, true)).join(', ');
}
