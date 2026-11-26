/**
 * Import d'une société (statuts, extrait Kbis) par le modèle de langage local.
 *
 * Même principe que l'import de bail : prompt généré depuis le schéma zod, réponse validée avec
 * tolérance. Rien n'est enregistré directement — les données pré-remplissent le formulaire de
 * société, où elles sont relues puis validées par `SocieteSaisieSchema` comme une saisie manuelle.
 */
import { z } from 'zod';
import { CiviliteSchema, FormeJuridiqueSchema, RegimeFiscalSchema, type Societe } from '../schemas.js';
import {
  dateLue,
  modeleReponse,
  montantLu,
  normaliser,
  normaliserTexte,
  objetReponse,
  opt,
  selectionnerPassages,
  texteLu,
  validerListe,
  validerTolerant,
  type ExtractionDocument,
} from './commun.js';

// ---------------------------------------------------------------------------
// Schéma de la réponse attendue
// ---------------------------------------------------------------------------

export const AssocieExtraitSchema = z.object({
  civilite: opt(CiviliteSchema, 'civilité'),
  nom: z.string().trim().min(1).describe('nom de famille (ou dénomination si l’associé est une société)'),
  prenom: texteLu('prénom(s)'),
  nombre_parts: opt(z.number().int().min(0), 'nombre de parts détenues'),
  est_gerant: opt(z.boolean(), 'est gérant ou président de la société'),
});

export const ExtractionSocieteSchema = z.object({
  raison_sociale: texteLu('dénomination sociale'),
  forme_juridique: opt(
    FormeJuridiqueSchema,
    'SCI = société civile (immobilière) ; SARL ; SARL_FAMILLE = SARL de famille ; SAS ; SASU ; EURL ; SNC ; AUTRE',
  ),
  siren: opt(z.string().regex(/^\d{9}$/), 'numéro SIREN (9 chiffres, figure dans « RCS Ville 123 456 789 »)'),
  rcs_ville: texteLu('ville du greffe où la société est immatriculée'),
  date_creation: dateLue('date d’immatriculation, ou à défaut de signature des statuts'),
  date_cloture_exercice: opt(
    z.string().regex(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])$/),
    'jour et mois de clôture de l’exercice social, ex. "31/12"',
  ),
  capital: montantLu('capital social'),
  nombre_parts: opt(z.number().int().min(1), 'nombre total de parts sociales ou d’actions'),
  valeur_nominale_part: montantLu('valeur nominale d’une part'),
  regime_fiscal: opt(RegimeFiscalSchema, 'IR = impôt sur le revenu (par défaut) ; IS = option pour l’impôt sur les sociétés'),
  objet_social: texteLu('objet social, résumé en une phrase'),
  representant_nom: texteLu('prénom et nom du gérant ou du président'),
  representant_qualite: texteLu('qualité du représentant, ex. "Gérant"'),
  adresse_ligne1: texteLu('numéro et voie du siège social'),
  code_postal: texteLu('code postal du siège'),
  ville: texteLu('commune du siège'),
  associes: z.array(AssocieExtraitSchema).describe('associés et répartition des parts'),
});

export type AssocieExtrait = z.output<typeof AssocieExtraitSchema>;
export type ExtractionSociete = z.output<typeof ExtractionSocieteSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Tokens réservés à la réponse (≈ 15 champs + quelques associés). */
export const MAX_TOKENS_REPONSE_SOCIETE = 800;

const MODELE_REPONSE = modeleReponse(ExtractionSocieteSchema);

/**
 * Prompt au format Mistral Instruct (`[INST] … [/INST]`, le token `<s>` est ajouté par le tokenizer).
 * `document` est le texte extrait du PDF (statuts ou Kbis), éventuellement réduit.
 */
export function promptExtractionSociete(document: string): string {
  return `[INST] Tu extrais les informations des statuts ou de l’extrait Kbis d’une société française.
Réponds uniquement par un objet JSON valide conforme au modèle ci-dessous, sans texte autour.
Règles :
- n’invente rien : mets null si l’information n’est pas dans le document ;
- montants en nombres décimaux avec un point (1000.5), sans symbole € ;
- dates au format AAAA-MM-JJ ;
- pour les choix entre guillemets, utilise exactement l’une des valeurs proposées ;
- les associés sont les personnes qui détiennent des parts, avec leur nombre de parts.

Modèle :
${MODELE_REPONSE}

Document :
"""
${document.trim()}
"""
[/INST]`;
}

/**
 * Passages de statuts ou d'un Kbis qui portent les informations recherchées.
 * Les mots courts sont délimités par `(?<!\p{L})…(?!\p{L})` et non `\b`, qui ne connaît que l'ASCII :
 * `\bparts?\b` reconnaîtrait « départ » (le « é » compte comme une frontière de mot).
 */
const MOTS_CLES =
  /d[ée]nomination|(?<!\p{L})formes?(?!\p{L})|soci[ée]t[ée] civile|capital|(?<!\p{L})parts?(?!\p{L})|(?<!\p{L})actions?(?!\p{L})|apports?|si[èe]ge|objet|exercice|cl[ôo]tur|g[ée]ran|pr[ée]sident|associ[ée]|immatricul|rcs|greffe|siren|imp[ôo]t|n[ée]e? le|demeurant/iu;

export function selectionnerPassagesSociete(texte: string, maxCaracteres: number): string {
  return selectionnerPassages(texte, maxCaracteres, MOTS_CLES);
}

/** Import de statuts ou d'un Kbis (consommé par le service d'IA de l'application). */
export const EXTRACTION_SOCIETE: ExtractionDocument = {
  prompt: promptExtractionSociete,
  maxTokens: MAX_TOKENS_REPONSE_SOCIETE,
  selectionner: selectionnerPassagesSociete,
};

// ---------------------------------------------------------------------------
// Analyse de la réponse
// ---------------------------------------------------------------------------

export interface ResultatExtractionSociete {
  donnees: ExtractionSociete;
  /** Champs proposés par le modèle mais invalides, donc ignorés (à vérifier dans le formulaire). */
  champsIgnores: string[];
}

/**
 * Valide la réponse du modèle avec zod. Un champ invalide n'invalide pas tout le résultat :
 * il est remplacé par `null` et signalé, l'utilisateur complète dans le formulaire.
 */
export function analyserReponseSociete(sortie: string): ResultatExtractionSociete {
  const objet = normaliser(objetReponse(sortie), ExtractionSocieteSchema);
  const champsIgnores: string[] = [];

  // « 123 456 789 », « RCS Paris 123.456.789 » → « 123456789 » (un autre nombre de chiffres sera refusé).
  if (typeof objet['siren'] === 'string') objet['siren'] = objet['siren'].replace(/\D/g, '') || null;

  objet['associes'] = validerListe(objet['associes'], AssocieExtraitSchema, 'associes', 'nom', champsIgnores);

  const donnees = validerTolerant(objet, ExtractionSocieteSchema, ['associes'], champsIgnores);
  return { donnees, champsIgnores: [...new Set(champsIgnores)] };
}

// ---------------------------------------------------------------------------
// Rapprochement avec les données existantes
// ---------------------------------------------------------------------------

/** Société déjà enregistrée avec le même SIREN, ou à défaut la même raison sociale. */
export function rapprocherSociete<S extends Pick<Societe, 'id' | 'raison_sociale' | 'siren'>>(
  extrait: Pick<ExtractionSociete, 'raison_sociale' | 'siren'>,
  societes: readonly S[],
): S | null {
  const siren = extrait.siren?.replace(/\D/g, '');
  if (siren) {
    const memeSiren = societes.find((s) => s.siren?.replace(/\D/g, '') === siren);
    if (memeSiren) return memeSiren;
  }
  const nom = normaliserTexte(extrait.raison_sociale);
  if (!nom) return null;
  return societes.find((s) => normaliserTexte(s.raison_sociale) === nom) ?? null;
}
