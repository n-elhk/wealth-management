import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { ouvrirDepot, type Depot, type SqlDriver } from '../src/index.js';

/** Adaptateur node:sqlite → SqlDriver (même contrat que @tauri-apps/plugin-sql). */
function driverMemoire(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    async execute(sql, params = []) {
      const r = db.prepare(sql).run(...(params as never[]));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
  };
}

let depot: Depot;

beforeEach(async () => {
  depot = await ouvrirDepot(driverMemoire());
});

async function jeuDeDonnees() {
  const societeId = await depot.societes.creer({
    raison_sociale: 'SCI Les Tilleuls',
    forme_juridique: 'SCI',
    date_creation: '2020-03-01',
    capital: 1000,
    nombre_parts: 100,
    ville: 'Lyon',
  });
  await depot.societes.associes.creer({ societe_id: societeId, nom: 'Dupont', prenom: 'Jean', nombre_parts: 60, est_gerant: 1 });
  await depot.societes.associes.creer({ societe_id: societeId, nom: 'Dupont', prenom: 'Marie', nombre_parts: 40, est_gerant: 0 });

  const bienSci = await depot.biens.creer({
    libelle: 'T3 Croix-Rousse', type_bien: 'appartement', detenteur: 'societe', societe_id: societeId,
    etage: '3', numero_lot: '12', surface_habitable: 68, meuble: 0,
    adresse_ligne1: '12 rue d’Austerlitz', code_postal: '69004', ville: 'Lyon',
  });
  const bienPerso = await depot.biens.creer({
    libelle: 'Maison Annecy', type_bien: 'maison', detenteur: 'personnel', meuble: 0,
    adresse_ligne1: '3 chemin des Vignes', code_postal: '74000', ville: 'Annecy',
  });
  const julie = await depot.locataires.creer({ nom: 'Martin', prenom: 'Julie', date_naissance: '1992-04-03' });
  const paul = await depot.locataires.creer({ nom: 'Durand', prenom: 'Paul' });

  const bailId = await depot.baux.creer({
    bien_id: bienSci, type_bail: 'habitation_vide', statut: 'actif', date_debut: '2025-01-15', duree_mois: 36,
    tacite_reconduction: 1, loyer_hc: 800, charges: 50, mode_charges: 'provision', depot_garantie: 800,
    jour_paiement: 5, paiement_terme: 'echoir', zone_tendue: 0, irl_valeur_reference: 144.64,
  });
  await depot.baux.definirLocataires(bailId, [
    { locataire_id: julie, role: 'titulaire' },
    { locataire_id: paul, role: 'colocataire' },
  ]);
  return { societeId, bienSci, bienPerso, julie, paul, bailId };
}

describe('migrations', () => {
  it('sont idempotentes', async () => {
    const driver = driverMemoire();
    await ouvrirDepot(driver);
    const { migrer } = await import('../src/index.js');
    expect(await migrer(driver)).toBe(0);
  });
});

describe('patrimoine', () => {
  it('rattache les biens à une société ou en nom propre', async () => {
    const { societeId } = await jeuDeDonnees();
    const societes = await depot.societes.listerResumes();
    expect(societes[0]).toMatchObject({ raison_sociale: 'SCI Les Tilleuls', nb_biens: 1, parts_attribuees: 100 });

    const perso = await depot.biens.listerResumes({ detenteur: 'personnel' });
    expect(perso.map((b) => b.libelle)).toEqual(['Maison Annecy']);

    const sci = await depot.biens.listerResumes({ societeId });
    expect(sci[0]).toMatchObject({ libelle: 'T3 Croix-Rousse', societe_nom: 'SCI Les Tilleuls', loyer_actuel: 850 });
    expect(sci[0]!.locataires_actuels).toContain('Julie Martin');
  });

  it('refuse un bien « société » sans société', async () => {
    await expect(depot.biens.creer({
      libelle: 'X', type_bien: 'studio', detenteur: 'societe', adresse_ligne1: '1 rue A', code_postal: '69001', ville: 'Lyon',
    })).rejects.toThrow(/société/);
  });

  it('force societe_id à NULL quand le bien passe en nom propre', async () => {
    const { bienSci } = await jeuDeDonnees();
    await depot.biens.modifier(bienSci, { detenteur: 'personnel', societe_id: 1 });
    expect((await depot.biens.exiger(bienSci)).societe_id).toBeNull();
  });

  it('empêche la suppression d’une société qui détient des biens', async () => {
    const { societeId } = await jeuDeDonnees();
    await expect(depot.societes.supprimer(societeId)).rejects.toThrow(/bien/);
  });

  it('enregistre le profil bailleur (upsert)', async () => {
    await depot.profil.enregistrer({ nom: 'Dupont', prenom: 'Jean' });
    await depot.profil.enregistrer({ nom: 'Dupont', prenom: 'Jean', ville: 'Lyon' });
    expect(await depot.profil.obtenir()).toMatchObject({ id: 1, nom: 'Dupont', ville: 'Lyon' });
  });
});

describe('baux et loyers', () => {
  it('conserve l’historique des locataires par bien', async () => {
    const { bienSci, bailId, julie } = await jeuDeDonnees();
    await depot.baux.modifier(bailId, { statut: 'termine', date_sortie: '2025-06-30' });
    const nouveau = await depot.locataires.creer({ nom: 'Petit', prenom: 'Léa' });
    const bail2 = await depot.baux.creer({
      bien_id: bienSci, type_bail: 'habitation_vide', statut: 'actif', date_debut: '2025-07-01', duree_mois: 36,
      loyer_hc: 820, charges: 50, depot_garantie: 820, jour_paiement: 1,
    });
    await depot.baux.definirLocataires(bail2, [{ locataire_id: nouveau, role: 'titulaire' }]);

    const historique = await depot.baux.listerResumes({ bienId: bienSci });
    expect(historique.map((b) => b.locataires_noms)).toEqual(['Léa Petit', 'Julie Martin, Paul Durand']);
    expect(await depot.baux.listerResumes({ locataireId: julie })).toHaveLength(1);
    await expect(depot.locataires.supprimer(julie)).rejects.toThrow(/historique/);
  });

  it('refuse deux baux actifs sur le même bien', async () => {
    const { bienSci } = await jeuDeDonnees();
    await expect(depot.baux.verifierChevauchement({ bien_id: bienSci, statut: 'actif' })).rejects.toThrow(/déjà un bail/);
  });

  it('génère les échéances et suit les paiements', async () => {
    const { bailId } = await jeuDeDonnees();
    const bail = await depot.baux.exiger(bailId);
    await depot.loyers.synchroniser(bail, '2025-03-10');
    await depot.loyers.synchroniser(bail, '2025-03-10'); // idempotent

    const echeances = await depot.loyers.listerParBail(bailId);
    expect(echeances.map((e) => e.periode)).toEqual(['2025-03', '2025-02', '2025-01']);

    const janvier = echeances.find((e) => e.periode === '2025-01')!;
    expect(janvier.loyer).toBe(438.71);
    await depot.loyers.solder(janvier.id, '2025-01-15', 'virement');
    const fevrier = echeances.find((e) => e.periode === '2025-02')!;
    await depot.loyers.paiements.creer({ echeance_id: fevrier.id, date_paiement: '2025-02-06', montant: 500, mode: 'virement' });

    const impayes = await depot.loyers.listerImpayes('2025-03-10');
    expect(impayes.map((e) => [e.periode, e.total_paye])).toEqual([
      ['2025-02', 500],
      ['2025-03', 0],
    ]);

    const stats = await depot.statistiques.tableauDeBord('2025-03-10');
    expect(stats).toMatchObject({ nb_biens: 2, nb_biens_loues: 1, nb_baux_actifs: 1, nb_locataires_actifs: 2 });
    expect(stats.impayes_total).toBe(350 + 850);
    expect(stats.historique).toHaveLength(3);
  });

  it('solde une échéance avec le mode de paiement du bail, une seule fois', async () => {
    const { bailId } = await jeuDeDonnees();
    await depot.baux.modifier(bailId, { mode_paiement: 'cheque' });
    const bail = await depot.baux.exiger(bailId);
    await depot.loyers.synchroniser(bail, '2025-01-10');
    const [janvier] = await depot.loyers.listerParBail(bailId);
    await depot.loyers.paiements.creer({ echeance_id: janvier!.id, date_paiement: '2025-01-05', montant: 0.1, mode: 'virement' });

    expect(await depot.loyers.solder(janvier!.id, '2025-01-15')).not.toBeNull();
    const paiements = await depot.loyers.listerPaiements(janvier!.id);
    expect(paiements.at(-1)).toMatchObject({ mode: 'cheque', montant: Math.round((janvier!.loyer + janvier!.charges - 0.1) * 100) / 100 });
    expect(await depot.loyers.solder(janvier!.id, '2025-01-20')).toBeNull();
  });

  it('supprime les échéances non payées après une sortie anticipée', async () => {
    const { bailId } = await jeuDeDonnees();
    let bail = await depot.baux.exiger(bailId);
    await depot.loyers.synchroniser(bail, '2025-05-10');
    await depot.baux.modifier(bailId, { statut: 'termine', date_sortie: '2025-03-20' });
    bail = await depot.baux.exiger(bailId);
    await depot.loyers.synchroniser(bail, '2025-05-10');

    const echeances = await depot.loyers.listerParBail(bailId);
    expect(echeances.map((e) => e.periode)).toEqual(['2025-03', '2025-02', '2025-01']);
    expect(echeances[0]!.date_fin_periode).toBe('2025-03-20');
  });

  it('applique une révision IRL sur les échéances non payées', async () => {
    const { bailId } = await jeuDeDonnees();
    const bail = await depot.baux.exiger(bailId);
    await depot.loyers.synchroniser(bail, '2026-02-10');
    await depot.loyers.appliquerRevision(
      bail,
      { date_effet: '2026-01-15', nouveau_loyer: 811.28, irl_trimestre: 'T4 2025', irl_nouveau: 146.68, notes: null },
      '2026-02-10',
    );
    const maj = await depot.baux.exiger(bailId);
    expect(maj).toMatchObject({ loyer_hc: 811.28, irl_valeur_reference: 146.68, irl_trimestre_reference: 'T4 2025' });

    const echeances = await depot.loyers.listerParBail(bailId);
    expect(echeances.find((e) => e.periode === '2026-02')!.loyer).toBe(811.28);
    expect(echeances.find((e) => e.periode === '2025-12')!.loyer).toBe(800);
    expect(await depot.baux.listerRevisions(bailId)).toHaveLength(1);
  });
});

describe('validation zod', () => {
  it('normalise les saisies (chaînes vides → NULL, espaces retirés)', async () => {
    const id = await depot.locataires.creer({ nom: '  Martin ', prenom: 'Julie', email: '', notes: '   ' });
    expect(await depot.locataires.exiger(id)).toMatchObject({ nom: 'Martin', email: null, notes: null });
  });

  it('refuse les données invalides avec un message lisible', async () => {
    await expect(depot.locataires.creer({ nom: 'Martin', prenom: 'Julie', email: 'pas-un-email' })).rejects.toThrow(
      /email : Adresse e-mail invalide/,
    );
    await expect(depot.locataires.creer({ nom: '', prenom: 'Julie' })).rejects.toThrow(/nom : Champ obligatoire/);
  });

  it('valide une modification partielle fusionnée avec la ligne existante', async () => {
    const { bailId } = await jeuDeDonnees();
    await expect(depot.baux.modifier(bailId, { statut: 'termine' })).rejects.toThrow(/date de sortie/);
    await expect(depot.baux.modifier(bailId, { statut: 'termine', date_sortie: '2024-12-31' })).rejects.toThrow(/antérieure/);
    await depot.baux.modifier(bailId, { statut: 'termine', date_sortie: '2025-06-30' });
    expect(await depot.baux.exiger(bailId)).toMatchObject({ statut: 'termine', date_sortie: '2025-06-30', loyer_hc: 800 });
  });

  it('refuse un paiement nul et une révision au format IRL invalide', async () => {
    const { bailId } = await jeuDeDonnees();
    await depot.loyers.synchroniser(await depot.baux.exiger(bailId), '2025-03-10');
    const [e] = await depot.loyers.listerParBail(bailId);
    await expect(depot.loyers.paiements.creer({ echeance_id: e!.id, date_paiement: '2025-03-05', montant: 0 })).rejects.toThrow(
      /montant/,
    );
    await expect(
      depot.loyers.appliquerRevision(
        await depot.baux.exiger(bailId),
        { date_effet: '2026-01-15', nouveau_loyer: 820, irl_trimestre: '2e trim.', irl_nouveau: 148, notes: null },
        '2026-01-20',
      ),
    ).rejects.toThrow(/T2 2025/);
  });
});
