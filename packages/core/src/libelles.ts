import type {
  ClasseEnergie,
  Civilite,
  Detenteur,
  FormeJuridique,
  ModeChauffage,
  ModeCharges,
  ModePaiement,
  RegimeFiscal,
  RegimeJuridiqueImmeuble,
  RoleLocataire,
  StatutBail,
  StatutEcheance,
  TypeBail,
  TypeBien,
  TermePaiement,
  TypeGarant,
} from './schemas.js';
import { ClasseEnergieSchema } from './schemas.js';

export interface Option<V extends string | number = string> {
  value: V;
  label: string;
}

function options<V extends string>(map: Record<V, string>): Option<V>[] {
  return (Object.keys(map) as V[]).map((value) => ({ value, label: map[value] }));
}

export const LIBELLES_CIVILITE: Record<Civilite, string> = { 'M.': 'M.', Mme: 'Mme', Mx: 'Mx' };

export const LIBELLES_FORME_JURIDIQUE: Record<FormeJuridique, string> = {
  SCI: 'SCI',
  SARL: 'SARL',
  SARL_FAMILLE: 'SARL de famille',
  SAS: 'SAS',
  SASU: 'SASU',
  EURL: 'EURL',
  SNC: 'SNC',
  AUTRE: 'Autre',
};

export const LIBELLES_REGIME_FISCAL: Record<RegimeFiscal, string> = {
  IR: 'Impôt sur le revenu (IR)',
  IS: 'Impôt sur les sociétés (IS)',
};

export const LIBELLES_TYPE_BIEN: Record<TypeBien, string> = {
  appartement: 'Appartement',
  maison: 'Maison',
  studio: 'Studio',
  chambre: 'Chambre',
  local_commercial: 'Local commercial',
  bureau: 'Bureau',
  parking: 'Parking',
  garage: 'Garage / box',
  cave: 'Cave',
  terrain: 'Terrain',
  immeuble: 'Immeuble',
  autre: 'Autre',
};

export const LIBELLES_DETENTEUR: Record<Detenteur, string> = {
  personnel: 'En nom propre',
  societe: 'Via une société',
};

export const LIBELLES_REGIME_JURIDIQUE: Record<RegimeJuridiqueImmeuble, string> = {
  copropriete: 'Copropriété',
  monopropriete: 'Monopropriété',
};

export const LIBELLES_MODE_CHAUFFAGE: Record<ModeChauffage, string> = {
  individuel: 'Individuel',
  collectif: 'Collectif',
  aucun: 'Aucun',
};

export const CLASSES_ENERGIE: readonly ClasseEnergie[] = ClasseEnergieSchema.options;

export const LIBELLES_TYPE_BAIL: Record<TypeBail, string> = {
  habitation_vide: 'Habitation — location vide',
  habitation_meuble: 'Habitation — location meublée',
  mobilite: 'Bail mobilité (meublé)',
  etudiant: 'Bail étudiant (meublé 9 mois)',
  parking: 'Parking / garage',
  professionnel: 'Bail professionnel',
  commercial: 'Bail commercial',
};

/** Durée par défaut (en mois) selon le type de bail. */
export const DUREE_DEFAUT_BAIL: Record<TypeBail, number> = {
  habitation_vide: 36,
  habitation_meuble: 12,
  mobilite: 10,
  etudiant: 9,
  parking: 12,
  professionnel: 72,
  commercial: 108,
};

export const LIBELLES_STATUT_BAIL: Record<StatutBail, string> = {
  brouillon: 'Brouillon',
  actif: 'En cours',
  termine: 'Terminé',
};

export const LIBELLES_MODE_CHARGES: Record<ModeCharges, string> = {
  provision: 'Provision avec régularisation annuelle',
  forfait: 'Forfait',
};

export const LIBELLES_TERME_PAIEMENT: Record<TermePaiement, string> = {
  echoir: 'Terme à échoir (début de mois)',
  echu: 'Terme échu (fin de mois)',
};

export const LIBELLES_MODE_PAIEMENT: Record<ModePaiement, string> = {
  virement: 'Virement',
  prelevement: 'Prélèvement',
  cheque: 'Chèque',
  especes: 'Espèces',
  caf: 'CAF / APL',
  autre: 'Autre',
};

export const LIBELLES_ROLE_LOCATAIRE: Record<RoleLocataire, string> = {
  titulaire: 'Titulaire',
  colocataire: 'Colocataire',
};

export const LIBELLES_TYPE_GARANT: Record<TypeGarant, string> = {
  personne: 'Personne physique (caution)',
  visale: 'Garantie Visale',
  organisme: 'Organisme / autre',
};

export const LIBELLES_STATUT_ECHEANCE: Record<StatutEcheance, string> = {
  payee: 'Payé',
  partielle: 'Partiel',
  en_retard: 'Impayé',
  a_venir: 'À venir',
  trop_percu: 'Trop-perçu',
};

export const OPTIONS = {
  civilite: options(LIBELLES_CIVILITE),
  formeJuridique: options(LIBELLES_FORME_JURIDIQUE),
  regimeFiscal: options(LIBELLES_REGIME_FISCAL),
  typeBien: options(LIBELLES_TYPE_BIEN),
  detenteur: options(LIBELLES_DETENTEUR),
  regimeJuridique: options(LIBELLES_REGIME_JURIDIQUE),
  modeChauffage: options(LIBELLES_MODE_CHAUFFAGE),
  classeEnergie: CLASSES_ENERGIE.map((c) => ({ value: c, label: c })),
  typeBail: options(LIBELLES_TYPE_BAIL),
  statutBail: options(LIBELLES_STATUT_BAIL),
  modeCharges: options(LIBELLES_MODE_CHARGES),
  modePaiement: options(LIBELLES_MODE_PAIEMENT),
  typeGarant: options(LIBELLES_TYPE_GARANT),
  termePaiement: options(LIBELLES_TERME_PAIEMENT),
};
