import { describe, expect, it } from 'vitest';
import {
  AssocieSaisieSchema,
  BienSaisieSchema,
  ErreurValidation,
  SocieteSaisieSchema,
  ajouterMois,
  calculerEcheances,
  calculerRevisionIRL,
  dateFinContractuelle,
  genererContratBail,
  genererQuittance,
  montantEnLettres,
  nombreEnLettres,
  parseISO,
  parsePeriode,
  prochaineDateRevision,
  resteDu,
  statutEcheance,
  valider,
  type Bail,
  type Bien,
  type Locataire,
} from '../src/index.js';

const bail: Bail = {
  id: 1,
  reference: 'B-2025-01',
  bien_id: 1,
  type_bail: 'habitation_vide',
  statut: 'actif',
  date_signature: '2025-01-10',
  date_debut: '2025-01-15',
  duree_mois: 36,
  tacite_reconduction: 1,
  date_sortie: null,
  motif_sortie: null,
  loyer_hc: 800,
  charges: 62,
  mode_charges: 'provision',
  depot_garantie: 800,
  jour_paiement: 5,
  paiement_terme: 'echoir',
  mode_paiement: 'virement',
  irl_trimestre_reference: 'T4 2024',
  irl_valeur_reference: 144.64,
  zone_tendue: 0,
  loyer_reference_majore: null,
  complement_loyer: null,
  dernier_loyer_precedent: null,
  destination: null,
  clauses_particulieres: 'Animaux acceptés.',
  notes: null,
};

describe('dates', () => {
  it('ajoute des mois en bornant la fin de mois', () => {
    expect(ajouterMois('2025-01-31', 1)).toBe('2025-02-28');
    expect(ajouterMois('2024-01-31', 1)).toBe('2024-02-29');
    expect(ajouterMois('2025-11-15', 3)).toBe('2026-02-15');
  });

  it('calcule la fin contractuelle', () => {
    expect(dateFinContractuelle(bail)).toBe('2028-01-14');
  });

  it('calcule la prochaine révision', () => {
    expect(prochaineDateRevision('2025-01-15', '2025-06-01')).toBe('2026-01-15');
    expect(prochaineDateRevision('2025-01-15', '2026-01-15')).toBe('2027-01-15');
  });

  it('refuse les dates et périodes invalides', () => {
    expect(parseISO('2025-03-07')).toEqual({ y: 2025, m: 3, d: 7 });
    expect(parsePeriode('2025-03')).toEqual({ y: 2025, m: 3 });
    expect(() => parseISO('2025-02-30')).toThrow('Date invalide');
    expect(() => parseISO('2025-03-07T10:00')).toThrow('Date invalide');
    expect(() => parsePeriode('2025-13')).toThrow('Période invalide');
  });
});

describe('échéances', () => {
  it('proratise le premier mois et s’arrête au mois demandé', () => {
    const e = calculerEcheances(bail, '2025-03-20');
    expect(e.map((x) => x.periode)).toEqual(['2025-01', '2025-02', '2025-03']);
    // 17 jours sur 31 en janvier
    expect(e[0]!.loyer).toBe(438.71);
    expect(e[0]!.date_debut_periode).toBe('2025-01-15');
    expect(e[0]!.date_echeance).toBe('2025-01-15');
    expect(e[1]!.loyer).toBe(800);
    expect(e[1]!.date_echeance).toBe('2025-02-05');
  });

  it('proratise le mois de sortie', () => {
    const e = calculerEcheances({ ...bail, date_sortie: '2025-04-10' }, '2025-12-31');
    expect(e.at(-1)!.periode).toBe('2025-04');
    expect(e.at(-1)!.loyer).toBe(266.67);
    expect(e.at(-1)!.date_fin_periode).toBe('2025-04-10');
  });

  it('terme échu : échéance en fin de mois', () => {
    const e = calculerEcheances({ ...bail, paiement_terme: 'echu' }, '2025-02-01');
    expect(e[1]!.date_echeance).toBe('2025-02-28');
  });

  it('détermine le statut', () => {
    const e = { loyer: 800, charges: 62, date_echeance: '2025-02-05' };
    expect(statutEcheance(e, 862, '2025-03-01')).toBe('payee');
    expect(statutEcheance(e, 400, '2025-03-01')).toBe('partielle');
    expect(statutEcheance(e, 0, '2025-03-01')).toBe('en_retard');
    expect(statutEcheance(e, 0, '2025-02-01')).toBe('a_venir');
    expect(statutEcheance(e, 900, '2025-03-01')).toBe('trop_percu');
  });

  it('calcule le reste dû sans erreur d’arrondi', () => {
    const e = { loyer: 600, charges: 50 };
    expect(resteDu(e, 0.1 + 649.9)).toBe(0);
    expect(resteDu(e, 400)).toBe(250);
    expect(resteDu(e, 700)).toBe(-50);
  });
});

describe('révision IRL', () => {
  it('applique la variation de l’indice', () => {
    expect(calculerRevisionIRL(800, 144.64, 146.68)).toBe(811.28);
  });
});

describe('montants en lettres', () => {
  it.each([
    [1, 'un'],
    [21, 'vingt et un'],
    [71, 'soixante et onze'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [99, 'quatre-vingt-dix-neuf'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [1000, 'mille'],
    [80000, 'quatre-vingt mille'],
    [200000, 'deux cent mille'],
    [1250, 'mille deux cent cinquante'],
  ])('%i → %s', (n, attendu) => {
    expect(nombreEnLettres(n)).toBe(attendu);
  });

  it('formate un montant', () => {
    expect(montantEnLettres(862.5)).toBe('huit cent soixante-deux euros et cinquante centimes');
    expect(montantEnLettres(1)).toBe('un euro');
  });
});

describe('documents', () => {
  const bien = {
    id: 1,
    libelle: 'T2 Lyon',
    type_bien: 'appartement',
    detenteur: 'personnel',
    adresse_ligne1: '12 rue des Lilas',
    code_postal: '69003',
    ville: 'Lyon',
    etage: '2',
    numero_lot: '14',
    regime_juridique: 'copropriete',
    meuble: 0,
  } as Bien;
  const locataires = [
    { id: 1, civilite: 'Mme', nom: 'Martin', prenom: 'Julie', date_naissance: '1992-04-03', lieu_naissance: 'Nantes' },
    { id: 2, civilite: 'M.', nom: 'Durand', prenom: 'Paul' },
  ] as Locataire[];

  it('génère un contrat avec clause de solidarité en colocation', () => {
    const doc = genererContratBail({ bail, bien, locataires, garants: [], societe: null, profil: null });
    const json = JSON.stringify(doc.content);
    expect(json).toContain('CONTRAT DE LOCATION');
    expect(json).toContain('CLAUSE DE SOLIDARITÉ');
    expect(json).toContain('MARTIN');
    expect(json).toContain('lot n° 14');
  });

  it('génère un reçu partiel si l’échéance n’est pas soldée', () => {
    const echeance = {
      id: 1, bail_id: 1, periode: '2025-02', date_echeance: '2025-02-05',
      date_debut_periode: '2025-02-01', date_fin_periode: '2025-02-28', loyer: 800, charges: 62, notes: null,
    };
    const base = { bail, bien, locataires, echeance, societe: null, profil: null, dateEmission: '2025-02-10' };
    const partiel = genererQuittance({
      ...base,
      paiements: [{ id: 1, echeance_id: 1, date_paiement: '2025-02-06', montant: 500, mode: 'virement', reference: null, notes: null }],
    });
    expect(JSON.stringify(partiel.content)).toContain('REÇU DE PAIEMENT PARTIEL');
    const complet = genererQuittance({
      ...base,
      paiements: [{ id: 1, echeance_id: 1, date_paiement: '2025-02-06', montant: 862, mode: 'virement', reference: null, notes: null }],
    });
    expect(JSON.stringify(complet.content)).toContain('QUITTANCE DE LOYER');
  });
});

describe('schémas zod', () => {
  it('valide et normalise une saisie de société', () => {
    const s = SocieteSaisieSchema.parse({ raison_sociale: ' SCI Test ', forme_juridique: 'SCI', siren: '123 456 789', iban: '' });
    expect(s).toMatchObject({ raison_sociale: 'SCI Test', siren: '123 456 789', iban: null, capital: null });
    expect(SocieteSaisieSchema.safeParse({ raison_sociale: 'X', forme_juridique: 'SCI', siren: '12' }).success).toBe(false);
    expect(SocieteSaisieSchema.safeParse({ raison_sociale: 'X', forme_juridique: 'SA' }).success).toBe(false);
  });

  it('convertit les booléens en 0/1 et refuse les dates impossibles', () => {
    const base = { societe_id: 1, nom: 'Dupont', nombre_parts: 10 };
    expect(AssocieSaisieSchema.parse({ ...base, est_gerant: true }).est_gerant).toBe(1);
    expect(AssocieSaisieSchema.parse(base).est_gerant).toBe(0);
    expect(() => valider(AssocieSaisieSchema, { ...base, date_entree: '2025-02-30' })).toThrow(ErreurValidation);
  });

  it('exige une société pour un bien détenu via une société', () => {
    const r = BienSaisieSchema.safeParse({
      libelle: 'T2', type_bien: 'appartement', detenteur: 'societe', adresse_ligne1: '1 rue A', code_postal: '69001', ville: 'Lyon',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['societe_id']);
  });
});
