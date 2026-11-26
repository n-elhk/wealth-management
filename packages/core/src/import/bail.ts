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

// ---------------------------------------------------------------------------
// Schéma de la réponse attendue
// ---------------------------------------------------------------------------

/**
 * Tous les champs sont nullables : le modèle répond `null` pour une information absente du document.
 * Les descriptions (`describe`) sont reprises dans le prompt.
 */
const opt = <T extends z.ZodType>(s: T, description: string) => s.nullable().describe(description);
const montant = (description: string) => opt(z.number().min(0), `${description}, en euros`);
const date = (description: string) => opt(z.iso.date(), `${description} (AAAA-MM-JJ)`);
const texte = (description: string) => opt(z.string().trim().min(1), description);

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

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  format?: string;
  pattern?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

/** Variantes d'un champ : zod écrit `anyOf` ou, pour un type simple nullable, `type: ["boolean", "null"]`. */
function variantes(s: JsonSchema): JsonSchema[] {
  if (s.anyOf) return s.anyOf;
  if (Array.isArray(s.type)) return s.type.map((type) => ({ ...s, type }));
  return [s];
}

/** Type compact d'un champ, déduit du JSON Schema généré par zod. */
function typeCompact(s: JsonSchema): string {
  const types = variantes(s).flatMap((v): string[] => {
    if (v.enum) return v.enum.map((e) => JSON.stringify(e));
    if (v.type === 'null') return ['null'];
    if (v.type === 'string') return [v.format === 'date' ? '"AAAA-MM-JJ"' : 'texte'];
    if (v.type === 'integer') return ['entier'];
    if (v.type === 'number') return ['nombre'];
    if (v.type === 'boolean') return ['true|false'];
    if (v.type === 'object' || v.type === 'array') return [modeleJson(v)];
    return ['valeur'];
  });
  return types.join(' | ');
}

/**
 * Modèle JSON commenté (plus compact qu'un JSON Schema complet, ce qui compte avec 4 096 tokens de contexte),
 * généré à partir du schéma zod : le prompt et la validation partagent une seule source.
 */
function modeleJson(s: JsonSchema, retrait = ''): string {
  if (s.type === 'array' && s.items) return `[${modeleJson(s.items, retrait)}, …]`;
  const lignes = Object.entries(s.properties ?? {}).map(([cle, p]) => {
    const commentaire = p.description && !p.properties && !p.items && !p.anyOf?.some((v) => v.properties) ? ` // ${p.description}` : '';
    const sousObjet = p.properties ? p : p.anyOf?.find((v) => v.properties);
    const valeur = sousObjet ? `${modeleJson(sousObjet, `${retrait}  `)} | null` : typeCompact(p);
    return `${retrait}  "${cle}": ${valeur}${commentaire}`;
  });
  return `{\n${lignes.join(',\n')}\n${retrait}}`;
}

const MODELE_REPONSE = modeleJson(z.toJSONSchema(ExtractionBailSchema, { target: 'draft-2020-12' }) as JsonSchema);

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
  const propre = texte.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (propre.length <= maxCaracteres) return propre;

  const paragraphes = propre.split(/\n\n/);
  const retenus = new Set<number>();
  let restant = maxCaracteres;
  const retenir = (i: number) => {
    const longueur = paragraphes[i]!.length + 2;
    if (retenus.has(i) || longueur > restant) return false;
    retenus.add(i);
    restant -= longueur;
    return true;
  };

  // 1. Début du document (≈ un tiers du budget).
  const tete = maxCaracteres / 3;
  for (let i = 0; i < paragraphes.length && maxCaracteres - restant < tete; i++) if (!retenir(i)) break;
  // 2. Paragraphes pertinents, dans l'ordre du document.
  paragraphes.forEach((p, i) => MOTS_CLES.test(p) && retenir(i));

  const morceaux = [...retenus].sort((a, b) => a - b).map((i) => paragraphes[i]!);
  // Un seul paragraphe géant (PDF sans sauts de ligne) : on tronque.
  if (morceaux.length === 0) return propre.slice(0, maxCaracteres);
  return morceaux.join('\n\n');
}

// ---------------------------------------------------------------------------
// Analyse de la réponse
// ---------------------------------------------------------------------------

/** Isole le premier objet JSON de la réponse (le modèle l'entoure parfois de ```json … ```). */
export function extraireObjetJson(sortie: string): unknown {
  const debut = sortie.indexOf('{');
  if (debut < 0) throw new Error('Le modèle n’a pas renvoyé de données exploitables.');
  let profondeur = 0;
  let dansChaine = false;
  let echappe = false;
  for (let i = debut; i < sortie.length; i++) {
    const c = sortie[i];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansChaine = false;
    } else if (c === '"') dansChaine = true;
    else if (c === '{') profondeur++;
    else if (c === '}' && --profondeur === 0) {
      try {
        return JSON.parse(sortie.slice(debut, i + 1));
      } catch {
        break;
      }
    }
  }
  throw new Error('La réponse du modèle n’est pas un JSON valide.');
}

/** « 1 250,50 € » → 1250.5 ; laisse les autres valeurs intactes (zod les rejettera si besoin). */
function nombreSouple(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.replace(/[\s €]/g, '').replace(/eur(os?)?$/i, '').replace(',', '.');
  return t !== '' && !Number.isNaN(Number(t)) ? Number(t) : v;
}

/** « 01/09/2025 » → « 2025-09-01 ». */
function dateSouple(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
}

function boolSouple(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (/^(oui|true|vrai)$/i.test(v.trim())) return true;
  if (/^(non|false|faux)$/i.test(v.trim())) return false;
  return v;
}

/** Corrige les écarts de forme courants du modèle (types, chaînes vides) avant validation. */
function normaliser(objet: Record<string, unknown>, schema: z.ZodObject): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const [cle, champ] of Object.entries(schema.shape)) {
    let v = objet[cle];
    if (v === undefined || v === '' || (typeof v === 'string' && /^(null|n\/a|non (précisé|renseigné))$/i.test(v.trim()))) {
      v = null;
    }
    const json = z.toJSONSchema(champ as z.ZodType) as JsonSchema;
    const type = variantes(json).find((t) => t.type !== 'null') ?? json;
    if (type.type === 'number' || type.type === 'integer') v = nombreSouple(v);
    else if (type.type === 'boolean') v = boolSouple(v);
    else if (type.format === 'date') v = dateSouple(v);
    else if (typeof v === 'number' && type.type === 'string') v = String(v);
    sortie[cle] = v;
  }
  return sortie;
}

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
  const brut = extraireObjetJson(sortie);
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
    throw new Error('La réponse du modèle n’est pas un objet JSON.');
  }
  const objet = normaliser(brut as Record<string, unknown>, ExtractionBailSchema);
  const champsIgnores: string[] = [];

  const bien = objet['bien'];
  if (bien !== null && typeof bien === 'object' && !Array.isArray(bien)) {
    const b = BienExtraitSchema.safeParse(normaliser(bien as Record<string, unknown>, BienExtraitSchema));
    objet['bien'] = b.success && Object.values(b.data).some((v) => v !== null) ? b.data : null;
    if (!b.success) champsIgnores.push('bien');
  } else objet['bien'] = null;

  const locataires = Array.isArray(objet['locataires']) ? objet['locataires'] : [];
  objet['locataires'] = locataires.flatMap((l, i) => {
    if (typeof l !== 'object' || l === null) return [];
    const nettoye = normaliser(l as Record<string, unknown>, LocataireExtraitSchema);
    const r = LocataireExtraitSchema.safeParse(nettoye);
    if (r.success) return [r.data];
    // Garde le locataire en retirant les champs invalides (sauf le nom, indispensable).
    for (const issue of r.error.issues) {
      const cle = issue.path[0];
      if (typeof cle === 'string' && cle !== 'nom') {
        nettoye[cle] = null;
        champsIgnores.push(`locataires[${i}].${cle}`);
      }
    }
    const reprise = LocataireExtraitSchema.safeParse(nettoye);
    return reprise.success ? [reprise.data] : [];
  });

  let resultat = ExtractionBailSchema.safeParse(objet);
  if (!resultat.success) {
    for (const issue of resultat.error.issues) {
      const cle = issue.path[0];
      if (typeof cle === 'string' && cle !== 'locataires' && cle !== 'bien') {
        objet[cle] = null;
        champsIgnores.push(cle);
      }
    }
    resultat = ExtractionBailSchema.safeParse(objet);
  }
  if (!resultat.success) throw new Error('Les données renvoyées par le modèle sont inexploitables.');
  return { donnees: resultat.data, champsIgnores: [...new Set(champsIgnores)] };
}

// ---------------------------------------------------------------------------
// Rapprochement avec les données existantes
// ---------------------------------------------------------------------------

/** Minuscules sans accents ni ponctuation. */
function normaliserTexte(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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
