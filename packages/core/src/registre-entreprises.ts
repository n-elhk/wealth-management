/**
 * Pré-remplissage d'une société à partir de l'API publique « Recherche d'entreprises »
 * (https://recherche-entreprises.api.gouv.fr, données INSEE / RNE, sans clé d'API).
 *
 * Ce module ne fait aucun appel réseau : il construit l'URL de recherche et convertit la réponse
 * en champs de `SocieteSaisie`. L'appel HTTP est fait par l'application.
 */
import { z } from 'zod';
import type { FormeJuridique, Societe } from './schemas.js';

export const URL_RECHERCHE_ENTREPRISES = 'https://recherche-entreprises.api.gouv.fr/search';

/** SIREN réduit à ses chiffres s'il en comporte exactement 9, sinon `null`. */
export function normaliserSiren(saisie: string | null | undefined): string | null {
  const chiffres = (saisie ?? '').replace(/[\s.]/g, '');
  return /^\d{9}$/.test(chiffres) ? chiffres : null;
}

/** « 123456789 » → « 123 456 789 ». */
export function formaterSiren(siren: string): string {
  return siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
}

export function urlRechercheSiren(siren: string): string {
  return `${URL_RECHERCHE_ENTREPRISES}?q=${encodeURIComponent(siren)}&page=1&per_page=5`;
}

const chaine = z.string().nullish().catch(null);

const DirigeantSchema = z.object({
  type_dirigeant: chaine,
  nom: chaine,
  prenoms: chaine,
  denomination: chaine,
  qualite: chaine,
});

const EntrepriseSchema = z.object({
  siren: z.string(),
  nom_raison_sociale: chaine,
  nom_complet: chaine,
  nature_juridique: chaine,
  date_creation: chaine,
  siege: z
    .object({
      numero_voie: chaine,
      indice_repetition: chaine,
      type_voie: chaine,
      libelle_voie: chaine,
      complement_adresse: chaine,
      code_postal: chaine,
      libelle_commune: chaine,
      libelle_pays_etranger: chaine,
    })
    .nullish()
    .catch(null),
  dirigeants: z.array(DirigeantSchema).nullish().catch(null),
});

export const ReponseRechercheEntreprisesSchema = z.object({
  results: z.array(z.unknown()).catch([]),
});

/** Champs d'une société renseignés par le registre (les autres restent à saisir). */
export type SocieteRegistre = Partial<
  Pick<
    Societe,
    | 'raison_sociale' | 'forme_juridique' | 'siren' | 'date_creation' | 'representant_nom' | 'representant_qualite'
    | 'adresse_ligne1' | 'adresse_ligne2' | 'code_postal' | 'ville' | 'pays'
  >
>;

/** Catégories juridiques INSEE (niveau III) → forme juridique de l'application. */
const FORMES_PAR_CATEGORIE: Record<string, FormeJuridique> = {
  '6540': 'SCI',
  '5498': 'EURL',
  '5499': 'SARL',
  '5710': 'SAS',
  '5720': 'SASU',
  '5202': 'SNC',
};

export function formeJuridiqueDepuisCategorie(code: string | null | undefined): FormeJuridique {
  return (code && FORMES_PAR_CATEGORIE[code]) || 'AUTRE';
}

/** Abréviations INSEE des types de voie les plus courantes. */
const TYPES_VOIE: Record<string, string> = {
  ALL: 'allée', AV: 'avenue', BD: 'boulevard', CHE: 'chemin', CRS: 'cours', ESP: 'esplanade', FG: 'faubourg',
  IMP: 'impasse', LD: 'lieu-dit', PAS: 'passage', PL: 'place', QUA: 'quartier', QUAI: 'quai', RES: 'résidence',
  RTE: 'route', RUE: 'rue', SQ: 'square', VOIE: 'voie',
};

const INDICES_REPETITION: Record<string, string> = { B: 'bis', T: 'ter', Q: 'quater' };

const PARTICULES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'aux', 'au']);

/** « DUPONT » → « Dupont », « RUE DE LA PAIX » → « Rue de la Paix », « SAINT-ÉTIENNE » → « Saint-Étienne ». */
function casseTitre(s: string, enDebut = true): string {
  return s
    .toLocaleLowerCase('fr-FR')
    .split(' ')
    .map((mot, i) =>
      (i > 0 || !enDebut) && PARTICULES.has(mot)
        ? mot
        : mot.replace(/(^|['’-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase('fr-FR')),
    )
    .join(' ');
}

const joindre = (...parties: (string | null | undefined)[]) => parties.filter(Boolean).join(' ') || null;

/**
 * Extrait de la réponse de l'API l'entreprise correspondant exactement au SIREN demandé,
 * convertie en champs de société. `null` si elle est absente.
 */
export function societeDepuisRegistre(reponse: unknown, siren: string): SocieteRegistre | null {
  const lue = ReponseRechercheEntreprisesSchema.safeParse(reponse);
  const e = (lue.success ? lue.data.results : [])
    .map((r) => EntrepriseSchema.safeParse(r))
    .find((r) => r.success && r.data.siren === siren)?.data;
  if (!e) return null;

  const s = e.siege;
  const voie = s
    ? joindre(
        s.numero_voie,
        s.indice_repetition && (INDICES_REPETITION[s.indice_repetition.toUpperCase()] ?? s.indice_repetition),
        s.type_voie && (TYPES_VOIE[s.type_voie.toUpperCase()] ?? s.type_voie.toLowerCase()),
        s.libelle_voie && casseTitre(s.libelle_voie, !s.type_voie),
      )
    : null;
  const dirigeant = e.dirigeants?.find((d) => d.type_dirigeant === 'personne physique' && d.nom);

  const champs: SocieteRegistre = {
    siren: formaterSiren(siren),
    raison_sociale: e.nom_raison_sociale || e.nom_complet || undefined,
    forme_juridique: formeJuridiqueDepuisCategorie(e.nature_juridique),
    date_creation: e.date_creation && /^\d{4}-\d{2}-\d{2}$/.test(e.date_creation) ? e.date_creation : undefined,
    adresse_ligne1: voie ?? undefined,
    adresse_ligne2: s?.complement_adresse ? casseTitre(s.complement_adresse) : null,
    code_postal: s?.code_postal ?? undefined,
    ville: s?.libelle_commune ? casseTitre(s.libelle_commune) : undefined,
    pays: s?.libelle_pays_etranger ? casseTitre(s.libelle_pays_etranger) : 'France',
  };
  if (dirigeant) {
    champs.representant_nom = joindre(dirigeant.prenoms && casseTitre(dirigeant.prenoms), dirigeant.nom?.toUpperCase());
    if (dirigeant.qualite) champs.representant_qualite = dirigeant.qualite;
  }
  return champs;
}
