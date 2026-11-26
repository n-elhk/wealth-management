/**
 * Outils communs à l'import de documents par le modèle de langage local (bail, société…).
 *
 * Chaque type de document décrit la réponse attendue par un schéma zod : le prompt (modèle JSON
 * commenté) et la validation de la réponse partagent cette source unique. Le module est pur.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Briques de schéma de réponse
// ---------------------------------------------------------------------------

/**
 * Champ de réponse : nullable, le modèle répond `null` pour une information absente du document.
 * La description (`describe`) est reprise dans le prompt.
 */
export const opt = <T extends z.ZodType>(s: T, description: string) => s.nullable().describe(description);
export const montantLu = (description: string) => opt(z.number().min(0), `${description}, en euros`);
export const dateLue = (description: string) => opt(z.iso.date(), `${description} (AAAA-MM-JJ)`);
export const texteLu = (description: string) => opt(z.string().trim().min(1), description);

/** Description d'un type de document importable, consommée par le service d'IA de l'application. */
export interface ExtractionDocument {
  /** Prompt complet pour le texte (éventuellement réduit) du document. */
  prompt(document: string): string;
  /** Tokens réservés à la réponse. */
  maxTokens: number;
  /** Réduit le texte à `maxCaracteres` en gardant les passages utiles. */
  selectionner(texte: string, maxCaracteres: number): string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

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

/**
 * Modèle JSON commenté de la réponse (plus compact qu'un JSON Schema complet, ce qui compte avec
 * 4 096 tokens de contexte), généré à partir du schéma zod.
 */
export function modeleReponse(schema: z.ZodObject): string {
  return modeleJson(z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonSchema);
}

// ---------------------------------------------------------------------------
// Réduction du document au budget de contexte
// ---------------------------------------------------------------------------

/**
 * Réduit le document à `maxCaracteres` en conservant l'ordre : le début (parties, identification)
 * puis les paragraphes contenant des `motsCles`, jusqu'à épuisement du budget.
 */
export function selectionnerPassages(texte: string, maxCaracteres: number, motsCles: RegExp): string {
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
  paragraphes.forEach((p, i) => motsCles.test(p) && retenir(i));

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

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Objet JSON de la réponse du modèle. */
export function objetReponse(sortie: string): Record<string, unknown> {
  const brut = extraireObjetJson(sortie);
  if (!estObjet(brut)) throw new Error('La réponse du modèle n’est pas un objet JSON.');
  return brut;
}

/** « 1 250,50 € » → 1250.5 ; laisse les autres valeurs intactes (zod les rejettera si besoin). */
function nombreSouple(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.replace(/[\s €]/g, '').replace(/eur(os?)?$/i, '').replace(',', '.');
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
export function normaliser(objet: Record<string, unknown>, schema: z.ZodObject): Record<string, unknown> {
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

/**
 * Valide les éléments d'une liste de la réponse (locataires, associés…). Un élément dont un champ est
 * invalide est gardé sans ce champ (signalé dans `champsIgnores`), sauf si le champ `indispensable` manque.
 */
export function validerListe<S extends z.ZodObject>(
  valeur: unknown,
  schema: S,
  nom: string,
  indispensable: string,
  champsIgnores: string[],
): z.output<S>[] {
  const elements = Array.isArray(valeur) ? valeur : [];
  return elements.flatMap((e, i) => {
    if (!estObjet(e)) return [];
    const nettoye = normaliser(e, schema);
    const r = schema.safeParse(nettoye);
    if (r.success) return [r.data];
    for (const issue of r.error.issues) {
      const cle = issue.path[0];
      if (typeof cle === 'string' && cle !== indispensable) {
        nettoye[cle] = null;
        champsIgnores.push(`${nom}[${i}].${cle}`);
      }
    }
    const reprise = schema.safeParse(nettoye);
    return reprise.success ? [reprise.data] : [];
  });
}

/**
 * Validation finale tolérante : un champ invalide n'invalide pas tout le résultat, il est remplacé
 * par `null` et signalé. Les champs `dejaValides` (listes, sous-objets) ne sont pas touchés.
 */
export function validerTolerant<S extends z.ZodObject>(
  objet: Record<string, unknown>,
  schema: S,
  dejaValides: readonly string[],
  champsIgnores: string[],
): z.output<S> {
  let resultat = schema.safeParse(objet);
  if (!resultat.success) {
    for (const issue of resultat.error.issues) {
      const cle = issue.path[0];
      if (typeof cle === 'string' && !dejaValides.includes(cle)) {
        objet[cle] = null;
        champsIgnores.push(cle);
      }
    }
    resultat = schema.safeParse(objet);
  }
  if (!resultat.success) throw new Error('Les données renvoyées par le modèle sont inexploitables.');
  return resultat.data;
}

// ---------------------------------------------------------------------------
// Rapprochement avec les données existantes
// ---------------------------------------------------------------------------

/** Minuscules sans accents ni ponctuation. */
export function normaliserTexte(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
