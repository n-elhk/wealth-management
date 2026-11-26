/**
 * Import d'un contrat de location par un modèle de langage local (Mistral 7B Instruct, via Candle côté Rust).
 *
 * Le module est pur : il construit le prompt, analyse la réponse du modèle et la valide avec zod.
 * Rien n'est enregistré directement — les données extraites pré-remplissent le formulaire de bail,
 * où elles sont relues puis validées par `BailSaisieSchema` comme une saisie manuelle.
 */
import { z } from 'zod';
import {
  CiviliteSchema,
  ModeChargesSchema,
  ModePaiementSchema,
  TermePaiementSchema,
  TypeBailSchema,
  type Bien,
  type Locataire,
} from '../schemas.js';
import {
  dateLue as date,
  modeleReponse,
  montantLu as montant,
  normaliser,
  normaliserTexte,
  objetReponse,
  opt,
  selectionnerPassages as selectionnerPassagesCommun,
  texteLu as texte,
  validerListe,
  validerTolerant,
  type ExtractionDocument,
} from './commun.js';

export { extraireObjetJson } from './commun.js';

// ---------------------------------------------------------------------------
// Schéma de la réponse attendue
// ---------------------------------------------------------------------------

export const LocataireExtraitSchema = z.object({
  civilite: opt(CiviliteSchema, 'civilité'),
  nom: z.string().trim().min(1).describe('nom de famille'),
  prenom: texte('prénom(s)'),
  date_naissance: date('date de naissance'),
  lieu_naissance: texte('lieu de naissance'),
  email: texte('adresse e-mail'),
  telephone: texte('téléphone'),
  profession: texte('profession'),
});

export const BienExtraitSchema = z.object({
  adresse_ligne1: texte('numéro et voie du logement loué'),
  code_postal: texte('code postal'),
  ville: texte('commune'),
});

export const ExtractionBailSchema = z.object({
  type_bail: opt(
    TypeBailSchema,
    'habitation_vide = location nue ; habitation_meuble = meublé ; mobilite = bail mobilité ; etudiant = bail étudiant (9 mois) ; parking ; professionnel ; commercial',
  ),
  date_signature: date('date de signature du contrat'),
  date_debut: date('date de prise d’effet du bail'),
  duree_mois: opt(z.number().int().min(1), 'durée du bail en mois (3 ans = 36)'),
  tacite_reconduction: opt(z.boolean(), 'reconduction tacite prévue'),
  loyer_hc: montant('loyer mensuel hors charges'),
  charges: montant('provision ou forfait de charges mensuel'),
  mode_charges: opt(ModeChargesSchema, 'provision (régularisation annuelle) ou forfait'),
  depot_garantie: montant('dépôt de garantie'),
  jour_paiement: opt(z.number().int().min(1).max(31), 'jour du mois où le loyer est payable'),
  paiement_terme: opt(TermePaiementSchema, 'echoir = payable d’avance ; echu = à terme échu'),
  mode_paiement: opt(ModePaiementSchema, 'mode de paiement du loyer'),
  irl_trimestre_reference: opt(z.string().regex(/^T[1-4] \d{4}$/), 'trimestre de l’IRL de référence, ex. "T2 2025"'),
  irl_valeur_reference: opt(z.number().positive(), 'valeur de l’IRL de référence, ex. 145.17'),
  zone_tendue: opt(z.boolean(), 'logement en zone tendue / soumis à l’encadrement des loyers'),
  loyer_reference_majore: opt(z.number().min(0), 'loyer de référence majoré, en euros par m²'),
  complement_loyer: montant('complément de loyer'),
  dernier_loyer_precedent: montant('dernier loyer du locataire précédent'),
  destination: texte('destination des locaux, ex. "Usage exclusif d’habitation principale"'),
  bien: BienExtraitSchema.nullable().describe('logement loué'),
  locataires: z.array(LocataireExtraitSchema).describe('locataire(s) signataire(s), jamais le bailleur'),
});

export type LocataireExtrait = z.output<typeof LocataireExtraitSchema>;
export type BienExtrait = z.output<typeof BienExtraitSchema>;
export type ExtractionBail = z.output<typeof ExtractionBailSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Tokens réservés à la réponse (≈ 20 champs + quelques locataires). */
export const MAX_TOKENS_REPONSE_BAIL = 900;

const MODELE_REPONSE = modeleReponse(ExtractionBailSchema);

/**
 * Prompt au format Mistral Instruct (`[INST] … [/INST]`, le token `<s>` est ajouté par le tokenizer).
 * `document` est le texte extrait du PDF (Markdown), éventuellement réduit par `selectionnerPassages`.
 */
export function promptExtractionBail(document: string): string {
  return `[INST] Tu extrais les informations d’un contrat de location français.
Réponds uniquement par un objet JSON valide conforme au modèle ci-dessous, sans texte autour.
Règles :
- n’invente rien : mets null si l’information n’est pas dans le document ;
- montants en nombres décimaux avec un point (850.5), sans symbole € ;
- dates au format AAAA-MM-JJ ;
- pour les choix entre guillemets, utilise exactement l’une des valeurs proposées ;
- le bailleur n’est pas un locataire.

Modèle :
${MODELE_REPONSE}

Document :
"""
${document.trim()}
"""
[/INST]`;
}

// ---------------------------------------------------------------------------
// Réduction du document au budget de contexte
// ---------------------------------------------------------------------------

/** Passages d'un bail qui portent les informations recherchées. */
const MOTS_CLES =
  /loyer|charges?\b|d[ée]p[ôo]t|garantie|dur[ée]e|prise d.effet|commence|[ée]ch[ée]ance|payable|terme|virement|pr[ée]l[èe]vement|ch[èe]que|irl|indice|r[ée]vision|zone tendue|encadrement|compl[ée]ment|r[ée]f[ée]rence|meubl[ée]|locataire|preneur|n[ée]e? le|n[ée]e? à|adresse|situ[ée]|destination|reconduction|fait à|sign/i;

/**
 * Réduit le document à `maxCaracteres` en conservant l'ordre : le début (parties, désignation du logement)
 * puis les paragraphes contenant des mots-clés du bail, jusqu'à épuisement du budget.
 */
export function selectionnerPassages(texte: string, maxCaracteres: number): string {
  return selectionnerPassagesCommun(texte, maxCaracteres, MOTS_CLES);
}

/** Import d'un contrat de location (consommé par le service d'IA de l'application). */
export const EXTRACTION_BAIL: ExtractionDocument = {
  prompt: promptExtractionBail,
  maxTokens: MAX_TOKENS_REPONSE_BAIL,
  selectionner: selectionnerPassages,
};

// ---------------------------------------------------------------------------
// Analyse de la réponse
// ---------------------------------------------------------------------------

export interface ResultatExtractionBail {
  donnees: ExtractionBail;
  /** Champs proposés par le modèle mais invalides, donc ignorés (à vérifier dans le formulaire). */
  champsIgnores: string[];
}

/**
 * Valide la réponse du modèle avec zod. Un champ invalide n'invalide pas tout le résultat :
 * il est remplacé par `null` et signalé, l'utilisateur complète dans le formulaire.
 */
export function analyserReponseBail(sortie: string): ResultatExtractionBail {
  const objet = normaliser(objetReponse(sortie), ExtractionBailSchema);
  const champsIgnores: string[] = [];

  const bien = objet['bien'];
  if (bien !== null && typeof bien === 'object' && !Array.isArray(bien)) {
    const b = BienExtraitSchema.safeParse(normaliser(bien as Record<string, unknown>, BienExtraitSchema));
    objet['bien'] = b.success && Object.values(b.data).some((v) => v !== null) ? b.data : null;
    if (!b.success) champsIgnores.push('bien');
  } else objet['bien'] = null;

  // Garde chaque locataire en retirant ses champs invalides (sauf le nom, indispensable).
  objet['locataires'] = validerListe(objet['locataires'], LocataireExtraitSchema, 'locataires', 'nom', champsIgnores);

  const donnees = validerTolerant(objet, ExtractionBailSchema, ['locataires', 'bien'], champsIgnores);
  return { donnees, champsIgnores: [...new Set(champsIgnores)] };
}

// ---------------------------------------------------------------------------
// Rapprochement avec les données existantes
// ---------------------------------------------------------------------------

const ABREVIATIONS: Record<string, string> = { bd: 'boulevard', bld: 'boulevard', av: 'avenue', ave: 'avenue', r: 'rue', pl: 'place', che: 'chemin', imp: 'impasse', all: 'allee', rte: 'route', fg: 'faubourg' };
const motsAdresse = (s: string | null) =>
  new Set(normaliserTexte(s).split(' ').filter(Boolean).map((m) => ABREVIATIONS[m] ?? m));

/**
 * Bien dont l'adresse correspond à celle du document : même code postal (ou même ville),
 * et au moins la moitié des mots de la voie en commun (numéro compris). `null` si aucun ne convient.
 */
export function rapprocherBien<B extends Pick<Bien, 'id' | 'adresse_ligne1' | 'code_postal' | 'ville'>>(
  extrait: BienExtrait | null,
  biens: readonly B[],
): B | null {
  if (!extrait?.adresse_ligne1) return null;
  const cible = motsAdresse(extrait.adresse_ligne1);
  let meilleur: { bien: B; score: number } | null = null;
  for (const bien of biens) {
    const memeCommune = extrait.code_postal
      ? normaliserTexte(bien.code_postal) === normaliserTexte(extrait.code_postal)
      : normaliserTexte(bien.ville) === normaliserTexte(extrait.ville);
    if (!memeCommune) continue;
    const mots = motsAdresse(bien.adresse_ligne1);
    const communs = [...cible].filter((m) => mots.has(m)).length;
    const score = communs / Math.max(cible.size, mots.size, 1);
    if (score >= 0.5 && (!meilleur || score > meilleur.score)) meilleur = { bien, score };
  }
  return meilleur?.bien ?? null;
}

/**
 * Locataire déjà enregistré portant les mêmes nom et prénom (sans tenir compte des accents ni de la casse).
 * Le prénom est exigé : des colocataires portent souvent le même nom de famille.
 */
export function rapprocherLocataire<L extends Pick<Locataire, 'id' | 'nom' | 'prenom'>>(
  extrait: LocataireExtrait,
  locataires: readonly L[],
): L | null {
  const nom = normaliserTexte(extrait.nom);
  const prenom = normaliserTexte(extrait.prenom);
  if (!prenom) return null;
  return locataires.find((l) => normaliserTexte(l.nom) === nom && normaliserTexte(l.prenom) === prenom) ?? null;
}
