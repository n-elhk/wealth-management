/**
 * Schémas zod du modèle métier : source unique des types (`z.output`) et des règles de validation,
 * partagée par les repositories (`@wealth-management/db`) et les formulaires de l'application.
 *
 * Conventions :
 * - `XxxSchema` décrit une ligne de la table (id + horodatage compris) ;
 * - `XxxSaisieSchema` décrit les données saisies (création / modification), sans id ni horodatage,
 *   avec les règles inter-champs (`superRefine`, qui conserve la forme `ZodObject`) ;
 * - les champs facultatifs valent `null` (comme en SQLite) et peuvent être omis à la saisie ;
 *   une chaîne vide ou blanche est normalisée en `null`.
 */
import { z } from 'zod';
import { fr } from 'zod/locales';

// Messages d'erreur en français. `jitless` : la CSP de l'application (script-src 'self')
// interdit `new Function`, utilisé par l'optimisation JIT de zod.
z.config(fr());
z.config({ jitless: true });

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

/** Champ facultatif : `null` par défaut, peut être omis à la saisie. */
const facultatif = <T extends z.ZodType>(s: T) => s.nullable().default(null);

/** Chaîne obligatoire (espaces retirés). */
const texte = () => z.string().trim().min(1, 'Champ obligatoire');
/** Chaîne facultative : '' → null. */
const texteOpt = () => facultatif(z.string().trim().transform((s) => s || null));
/** Chaîne facultative devant respecter un format une fois renseignée. */
const formatOpt = (format: z.ZodType<string, string>) =>
  facultatif(z.string().trim().transform((s) => s || null).pipe(format.nullable()));

export const IdSchema = z.number().int().positive();
/** Date au format ISO `YYYY-MM-DD` (date calendaire valide). */
export const ISODateSchema = z.iso.date({ error: 'Date invalide (AAAA-MM-JJ)' });
/** Mois au format `YYYY-MM`. */
export const PeriodeSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Période invalide (AAAA-MM)');
/** Booléen stocké en SQLite (0/1) ; accepte aussi true/false. */
export const BoolSchema = z.union([z.literal(0), z.literal(1), z.boolean()]).transform((v): 0 | 1 => (v ? 1 : 0));

const montant = () => z.number({ error: 'Montant invalide' }).finite().min(0, 'Le montant doit être positif');
const entier = () => z.number({ error: 'Nombre invalide' }).int('Nombre entier attendu').min(0);
const nombre = () => z.number({ error: 'Nombre invalide' }).finite();
const dateOpt = () => facultatif(ISODateSchema);
const email = () => formatOpt(z.email('Adresse e-mail invalide'));

export type ID = z.output<typeof IdSchema>;
export type ISODate = z.output<typeof ISODateSchema>;
export type Periode = z.output<typeof PeriodeSchema>;
export type Bool = z.output<typeof BoolSchema>;

const HorodatageSchema = z.object({
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
const avecId = { id: IdSchema, ...HorodatageSchema.shape };

export const AdresseSchema = z.object({
  adresse_ligne1: texteOpt(),
  adresse_ligne2: texteOpt(),
  code_postal: texteOpt(),
  ville: texteOpt(),
  pays: texteOpt(),
});

export type Horodatage = z.output<typeof HorodatageSchema>;
export type Adresse = z.output<typeof AdresseSchema>;

// ---------------------------------------------------------------------------
// Énumérations
// ---------------------------------------------------------------------------

export const CiviliteSchema = z.enum(['M.', 'Mme', 'Mx']);
export const FormeJuridiqueSchema = z.enum(['SCI', 'SARL', 'SARL_FAMILLE', 'SAS', 'SASU', 'EURL', 'SNC', 'AUTRE']);
export const RegimeFiscalSchema = z.enum(['IR', 'IS']);
export const TypeBienSchema = z.enum([
  'appartement', 'maison', 'studio', 'chambre', 'local_commercial', 'bureau', 'parking', 'garage', 'cave', 'terrain',
  'immeuble', 'autre',
]);
export const DetenteurSchema = z.enum(['personnel', 'societe']);
export const RegimeJuridiqueImmeubleSchema = z.enum(['copropriete', 'monopropriete']);
export const ModeChauffageSchema = z.enum(['individuel', 'collectif', 'aucun']);
export const ClasseEnergieSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
export const TypeBailSchema = z.enum([
  'habitation_vide', 'habitation_meuble', 'mobilite', 'etudiant', 'parking', 'professionnel', 'commercial',
]);
export const StatutBailSchema = z.enum(['brouillon', 'actif', 'termine']);
export const ModeChargesSchema = z.enum(['provision', 'forfait']);
export const TermePaiementSchema = z.enum(['echoir', 'echu']);
export const ModePaiementSchema = z.enum(['virement', 'prelevement', 'cheque', 'especes', 'caf', 'autre']);
export const RoleLocataireSchema = z.enum(['titulaire', 'colocataire']);
export const TypeGarantSchema = z.enum(['personne', 'visale', 'organisme']);
export const StatutEcheanceSchema = z.enum(['payee', 'partielle', 'en_retard', 'a_venir', 'trop_percu']);

export type Civilite = z.output<typeof CiviliteSchema>;
export type FormeJuridique = z.output<typeof FormeJuridiqueSchema>;
export type RegimeFiscal = z.output<typeof RegimeFiscalSchema>;
export type TypeBien = z.output<typeof TypeBienSchema>;
export type Detenteur = z.output<typeof DetenteurSchema>;
export type RegimeJuridiqueImmeuble = z.output<typeof RegimeJuridiqueImmeubleSchema>;
export type ModeChauffage = z.output<typeof ModeChauffageSchema>;
export type ClasseEnergie = z.output<typeof ClasseEnergieSchema>;
export type TypeBail = z.output<typeof TypeBailSchema>;
export type StatutBail = z.output<typeof StatutBailSchema>;
export type ModeCharges = z.output<typeof ModeChargesSchema>;
export type TermePaiement = z.output<typeof TermePaiementSchema>;
export type ModePaiement = z.output<typeof ModePaiementSchema>;
export type RoleLocataire = z.output<typeof RoleLocataireSchema>;
export type TypeGarant = z.output<typeof TypeGarantSchema>;
export type StatutEcheance = z.output<typeof StatutEcheanceSchema>;

/** Trimestre IRL, ex. « T2 2025 ». */
const trimestreIrl = () => formatOpt(z.string().regex(/^T[1-4] \d{4}$/, 'Format attendu : T2 2025'));

// ---------------------------------------------------------------------------
// Bailleur
// ---------------------------------------------------------------------------

/** Identité du bailleur en nom propre (une seule ligne, id = 1). */
export const ProfilBailleurSaisieSchema = AdresseSchema.extend({
  civilite: facultatif(CiviliteSchema),
  nom: texte(),
  prenom: texte(),
  date_naissance: dateOpt(),
  lieu_naissance: texteOpt(),
  email: email(),
  telephone: texteOpt(),
  iban: texteOpt(),
});
export const ProfilBailleurSchema = ProfilBailleurSaisieSchema.extend(avecId);

export const SocieteSaisieSchema = AdresseSchema.extend({
  raison_sociale: texte(),
  forme_juridique: FormeJuridiqueSchema,
  siren: formatOpt(z.string().regex(/^\d{3} ?\d{3} ?\d{3}$/, 'Le SIREN comporte 9 chiffres')),
  rcs_ville: texteOpt(),
  date_creation: dateOpt(),
  /** ex. "31/12" */
  date_cloture_exercice: formatOpt(z.string().regex(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])$/, 'Format attendu : JJ/MM')),
  capital: facultatif(montant()),
  nombre_parts: facultatif(entier()),
  valeur_nominale_part: facultatif(montant()),
  regime_fiscal: facultatif(RegimeFiscalSchema),
  objet_social: texteOpt(),
  representant_nom: texteOpt(),
  /** ex. "Gérant" */
  representant_qualite: texteOpt(),
  email: email(),
  telephone: texteOpt(),
  iban: texteOpt(),
  notes: texteOpt(),
});
export const SocieteSchema = SocieteSaisieSchema.extend(avecId);

export const AssocieSaisieSchema = z.object({
  societe_id: IdSchema,
  civilite: facultatif(CiviliteSchema),
  nom: texte(),
  prenom: texteOpt(),
  nombre_parts: entier(),
  date_entree: dateOpt(),
  est_gerant: BoolSchema.default(0),
  notes: texteOpt(),
});
export const AssocieSchema = AssocieSaisieSchema.extend(avecId);

export type ProfilBailleur = z.output<typeof ProfilBailleurSchema>;
export type Societe = z.output<typeof SocieteSchema>;
export type Associe = z.output<typeof AssocieSchema>;

// ---------------------------------------------------------------------------
// Biens
// ---------------------------------------------------------------------------

const BienChampsSchema = AdresseSchema.extend({
  libelle: texte(),
  type_bien: TypeBienSchema,
  detenteur: DetenteurSchema,
  societe_id: facultatif(IdSchema),
  /** Bien parent (ex. un lot dans un immeuble détenu en entier). */
  parent_id: facultatif(IdSchema),
  adresse_ligne1: texte(),
  code_postal: texte(),
  ville: texte(),
  batiment: texteOpt(),
  escalier: texteOpt(),
  etage: texteOpt(),
  porte: texteOpt(),
  numero_lot: texteOpt(),
  tantiemes: facultatif(nombre().min(0)),
  /** cave, parking... */
  lots_annexes: texteOpt(),
  regime_juridique: facultatif(RegimeJuridiqueImmeubleSchema),
  annee_construction: facultatif(z.number().int().min(1000).max(2100)),
  surface_habitable: facultatif(nombre().min(0)),
  surface_terrain: facultatif(nombre().min(0)),
  nb_pieces: facultatif(entier()),
  nb_chambres: facultatif(entier()),
  meuble: BoolSchema.default(0),
  chauffage_mode: facultatif(ModeChauffageSchema),
  chauffage_energie: texteOpt(),
  eau_chaude_mode: facultatif(ModeChauffageSchema),
  dpe_classe: facultatif(ClasseEnergieSchema),
  dpe_consommation: facultatif(nombre().min(0)),
  ges_classe: facultatif(ClasseEnergieSchema),
  equipements: texteOpt(),
  parties_communes: texteOpt(),
  date_acquisition: dateOpt(),
  prix_acquisition: facultatif(montant()),
  taxe_fonciere: facultatif(montant()),
  charges_copro_annuelles: facultatif(montant()),
  description: texteOpt(),
  notes: texteOpt(),
});

export const BienSaisieSchema = BienChampsSchema.superRefine((b, ctx) => {
  if (b.detenteur === 'societe' && !b.societe_id) {
    ctx.addIssue({ code: 'custom', path: ['societe_id'], message: 'Choisissez la société propriétaire du bien.' });
  }
});
export const BienSchema = BienChampsSchema.extend(avecId);

export type Bien = z.output<typeof BienSchema>;

// ---------------------------------------------------------------------------
// Locataires
// ---------------------------------------------------------------------------

export const LocataireSaisieSchema = z.object({
  civilite: facultatif(CiviliteSchema),
  nom: texte(),
  prenom: texte(),
  date_naissance: dateOpt(),
  lieu_naissance: texteOpt(),
  nationalite: texteOpt(),
  email: email(),
  telephone: texteOpt(),
  profession: texteOpt(),
  employeur: texteOpt(),
  revenus_mensuels: facultatif(montant()),
  situation_familiale: texteOpt(),
  adresse_precedente: texteOpt(),
  type_piece_identite: texteOpt(),
  numero_piece_identite: texteOpt(),
  notes: texteOpt(),
});
export const LocataireSchema = LocataireSaisieSchema.extend(avecId);

export type Locataire = z.output<typeof LocataireSchema>;

// ---------------------------------------------------------------------------
// Baux
// ---------------------------------------------------------------------------

const BailChampsSchema = z.object({
  reference: texteOpt(),
  bien_id: IdSchema,
  type_bail: TypeBailSchema,
  statut: StatutBailSchema.default('brouillon'),
  date_signature: dateOpt(),
  date_debut: ISODateSchema,
  duree_mois: z.number({ error: 'Durée invalide' }).int().min(1, 'Au moins 1 mois'),
  tacite_reconduction: BoolSchema.default(1),
  date_sortie: dateOpt(),
  motif_sortie: texteOpt(),
  loyer_hc: montant(),
  charges: montant().default(0),
  mode_charges: ModeChargesSchema.default('provision'),
  depot_garantie: montant().default(0),
  jour_paiement: z.number({ error: 'Jour invalide' }).int().min(1, 'Entre 1 et 31').max(31, 'Entre 1 et 31').default(1),
  paiement_terme: TermePaiementSchema.default('echoir'),
  mode_paiement: facultatif(ModePaiementSchema),
  /** ex. "T2 2025" */
  irl_trimestre_reference: trimestreIrl(),
  irl_valeur_reference: facultatif(nombre().positive()),
  zone_tendue: BoolSchema.default(0),
  loyer_reference_majore: facultatif(montant()),
  complement_loyer: facultatif(montant()),
  dernier_loyer_precedent: facultatif(montant()),
  /** ex. "Usage exclusif d'habitation principale" */
  destination: texteOpt(),
  clauses_particulieres: texteOpt(),
  notes: texteOpt(),
});

export const BailSaisieSchema = BailChampsSchema.superRefine((b, ctx) => {
  if (b.statut === 'termine' && !b.date_sortie) {
    ctx.addIssue({ code: 'custom', path: ['date_sortie'], message: 'Indiquez la date de sortie du locataire.' });
  }
  if (b.date_sortie && b.date_sortie < b.date_debut) {
    ctx.addIssue({ code: 'custom', path: ['date_sortie'], message: 'La date de sortie est antérieure au début du bail.' });
  }
});
export const BailSchema = BailChampsSchema.extend(avecId);

export const BailLocataireSchema = z.object({
  bail_id: IdSchema,
  locataire_id: IdSchema,
  role: RoleLocataireSchema,
});

export const GarantSaisieSchema = z.object({
  bail_id: IdSchema,
  type_garant: TypeGarantSchema.default('personne'),
  civilite: facultatif(CiviliteSchema),
  nom: texte(),
  prenom: texteOpt(),
  date_naissance: dateOpt(),
  adresse: texteOpt(),
  email: email(),
  telephone: texteOpt(),
  montant_engagement: facultatif(montant()),
  duree_engagement: texteOpt(),
  notes: texteOpt(),
});
export const GarantSchema = GarantSaisieSchema.extend(avecId);

export const RevisionLoyerSaisieSchema = z.object({
  bail_id: IdSchema,
  date_effet: ISODateSchema,
  ancien_loyer: montant(),
  nouveau_loyer: montant(),
  irl_trimestre: trimestreIrl(),
  irl_ancien: facultatif(nombre().positive()),
  irl_nouveau: facultatif(nombre().positive()),
  notes: texteOpt(),
});
export const RevisionLoyerSchema = RevisionLoyerSaisieSchema.extend(avecId);

export type Bail = z.output<typeof BailSchema>;
export type BailLocataire = z.output<typeof BailLocataireSchema>;
export type Garant = z.output<typeof GarantSchema>;
export type RevisionLoyer = z.output<typeof RevisionLoyerSchema>;

// ---------------------------------------------------------------------------
// Loyers & paiements
// ---------------------------------------------------------------------------

/** Appel de loyer mensuel. */
export const EcheanceSaisieSchema = z.object({
  bail_id: IdSchema,
  periode: PeriodeSchema,
  date_echeance: ISODateSchema,
  date_debut_periode: ISODateSchema,
  date_fin_periode: ISODateSchema,
  loyer: montant(),
  charges: montant(),
  notes: texteOpt(),
});
export const EcheanceSchema = EcheanceSaisieSchema.extend(avecId);

export const PaiementSaisieSchema = z.object({
  echeance_id: IdSchema,
  date_paiement: ISODateSchema,
  montant: z.number({ error: 'Montant invalide' }).finite().positive('Le montant doit être supérieur à 0'),
  mode: facultatif(ModePaiementSchema),
  reference: texteOpt(),
  notes: texteOpt(),
});
export const PaiementSchema = PaiementSaisieSchema.extend(avecId);

export type Echeance = z.output<typeof EcheanceSchema>;
export type Paiement = z.output<typeof PaiementSchema>;

/** Données nécessaires à la création d'une entité (sans id ni horodatage). */
export type Nouveau<T> = Omit<T, 'id' | 'created_at' | 'updated_at'>;

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

/** Message lisible d'une erreur de validation (« champ : message », un par ligne). */
export function messageValidation(e: z.ZodError): string {
  return e.issues.map((i) => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message)).join('\n');
}

/** Erreur levée quand des données ne respectent pas leur schéma. */
export class ErreurValidation extends Error {
  constructor(readonly erreur: z.ZodError) {
    super(messageValidation(erreur));
    this.name = 'ErreurValidation';
  }
}

/** Valide des données avec un schéma ; lève une `ErreurValidation` au message lisible. */
export function valider<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ErreurValidation(r.error);
  return r.data;
}
