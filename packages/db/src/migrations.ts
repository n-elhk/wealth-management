import type { SqlDriver } from './driver.js';

export interface Migration {
  version: number;
  nom: string;
  /** Instructions exécutées une par une (pas de transaction : le pool du plugin SQL ne la garantit pas). */
  instructions: string[];
}

const ADRESSE = `
  adresse_ligne1 TEXT,
  adresse_ligne2 TEXT,
  code_postal TEXT,
  ville TEXT,
  pays TEXT DEFAULT 'France'`;

const HORODATAGE = `
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    nom: 'schema_initial',
    instructions: [
      `CREATE TABLE profil_bailleur (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        civilite TEXT,
        nom TEXT,
        prenom TEXT,
        date_naissance TEXT,
        lieu_naissance TEXT,
        email TEXT,
        telephone TEXT,
        iban TEXT,${ADRESSE},${HORODATAGE}
      )`,

      `CREATE TABLE societe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raison_sociale TEXT NOT NULL,
        forme_juridique TEXT NOT NULL DEFAULT 'SCI',
        siren TEXT,
        rcs_ville TEXT,
        date_creation TEXT,
        date_cloture_exercice TEXT,
        capital REAL,
        nombre_parts INTEGER,
        valeur_nominale_part REAL,
        regime_fiscal TEXT,
        objet_social TEXT,
        representant_nom TEXT,
        representant_qualite TEXT,
        email TEXT,
        telephone TEXT,
        iban TEXT,
        notes TEXT,${ADRESSE},${HORODATAGE}
      )`,

      `CREATE TABLE associe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        societe_id INTEGER NOT NULL REFERENCES societe(id) ON DELETE CASCADE,
        civilite TEXT,
        nom TEXT NOT NULL,
        prenom TEXT,
        nombre_parts INTEGER NOT NULL DEFAULT 0,
        date_entree TEXT,
        est_gerant INTEGER NOT NULL DEFAULT 0,
        notes TEXT,${HORODATAGE}
      )`,
      `CREATE INDEX idx_associe_societe ON associe(societe_id)`,

      `CREATE TABLE bien (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle TEXT NOT NULL,
        type_bien TEXT NOT NULL,
        detenteur TEXT NOT NULL CHECK (detenteur IN ('personnel', 'societe')),
        societe_id INTEGER REFERENCES societe(id) ON DELETE RESTRICT,
        parent_id INTEGER REFERENCES bien(id) ON DELETE SET NULL,
        batiment TEXT,
        escalier TEXT,
        etage TEXT,
        porte TEXT,
        numero_lot TEXT,
        tantiemes REAL,
        lots_annexes TEXT,
        regime_juridique TEXT,
        annee_construction INTEGER,
        surface_habitable REAL,
        surface_terrain REAL,
        nb_pieces INTEGER,
        nb_chambres INTEGER,
        meuble INTEGER NOT NULL DEFAULT 0,
        chauffage_mode TEXT,
        chauffage_energie TEXT,
        eau_chaude_mode TEXT,
        dpe_classe TEXT,
        dpe_consommation REAL,
        ges_classe TEXT,
        equipements TEXT,
        parties_communes TEXT,
        date_acquisition TEXT,
        prix_acquisition REAL,
        taxe_fonciere REAL,
        charges_copro_annuelles REAL,
        description TEXT,
        notes TEXT,${ADRESSE},${HORODATAGE},
        CHECK ((detenteur = 'societe' AND societe_id IS NOT NULL) OR (detenteur = 'personnel' AND societe_id IS NULL))
      )`,
      `CREATE INDEX idx_bien_societe ON bien(societe_id)`,

      `CREATE TABLE locataire (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        civilite TEXT,
        nom TEXT NOT NULL,
        prenom TEXT NOT NULL,
        date_naissance TEXT,
        lieu_naissance TEXT,
        nationalite TEXT,
        email TEXT,
        telephone TEXT,
        profession TEXT,
        employeur TEXT,
        revenus_mensuels REAL,
        situation_familiale TEXT,
        adresse_precedente TEXT,
        type_piece_identite TEXT,
        numero_piece_identite TEXT,
        notes TEXT,${HORODATAGE}
      )`,

      `CREATE TABLE bail (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT,
        bien_id INTEGER NOT NULL REFERENCES bien(id) ON DELETE RESTRICT,
        type_bail TEXT NOT NULL,
        statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'actif', 'termine')),
        date_signature TEXT,
        date_debut TEXT NOT NULL,
        duree_mois INTEGER NOT NULL,
        tacite_reconduction INTEGER NOT NULL DEFAULT 1,
        date_sortie TEXT,
        motif_sortie TEXT,
        loyer_hc REAL NOT NULL,
        charges REAL NOT NULL DEFAULT 0,
        mode_charges TEXT NOT NULL DEFAULT 'provision',
        depot_garantie REAL NOT NULL DEFAULT 0,
        jour_paiement INTEGER NOT NULL DEFAULT 1 CHECK (jour_paiement BETWEEN 1 AND 31),
        paiement_terme TEXT NOT NULL DEFAULT 'echoir',
        mode_paiement TEXT,
        irl_trimestre_reference TEXT,
        irl_valeur_reference REAL,
        zone_tendue INTEGER NOT NULL DEFAULT 0,
        loyer_reference_majore REAL,
        complement_loyer REAL,
        dernier_loyer_precedent REAL,
        destination TEXT,
        clauses_particulieres TEXT,
        notes TEXT,${HORODATAGE}
      )`,
      `CREATE INDEX idx_bail_bien ON bail(bien_id)`,

      `CREATE TABLE bail_locataire (
        bail_id INTEGER NOT NULL REFERENCES bail(id) ON DELETE CASCADE,
        locataire_id INTEGER NOT NULL REFERENCES locataire(id) ON DELETE RESTRICT,
        role TEXT NOT NULL DEFAULT 'titulaire',
        PRIMARY KEY (bail_id, locataire_id)
      )`,
      `CREATE INDEX idx_bail_locataire_locataire ON bail_locataire(locataire_id)`,

      `CREATE TABLE garant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bail_id INTEGER NOT NULL REFERENCES bail(id) ON DELETE CASCADE,
        type_garant TEXT NOT NULL DEFAULT 'personne',
        civilite TEXT,
        nom TEXT NOT NULL,
        prenom TEXT,
        date_naissance TEXT,
        adresse TEXT,
        email TEXT,
        telephone TEXT,
        montant_engagement REAL,
        duree_engagement TEXT,
        notes TEXT,${HORODATAGE}
      )`,

      `CREATE TABLE revision_loyer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bail_id INTEGER NOT NULL REFERENCES bail(id) ON DELETE CASCADE,
        date_effet TEXT NOT NULL,
        ancien_loyer REAL NOT NULL,
        nouveau_loyer REAL NOT NULL,
        irl_trimestre TEXT,
        irl_ancien REAL,
        irl_nouveau REAL,
        notes TEXT,${HORODATAGE}
      )`,

      `CREATE TABLE echeance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bail_id INTEGER NOT NULL REFERENCES bail(id) ON DELETE CASCADE,
        periode TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        date_debut_periode TEXT NOT NULL,
        date_fin_periode TEXT NOT NULL,
        loyer REAL NOT NULL,
        charges REAL NOT NULL DEFAULT 0,
        notes TEXT,${HORODATAGE},
        UNIQUE (bail_id, periode)
      )`,
      `CREATE INDEX idx_echeance_periode ON echeance(periode)`,

      `CREATE TABLE paiement (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        echeance_id INTEGER NOT NULL REFERENCES echeance(id) ON DELETE CASCADE,
        date_paiement TEXT NOT NULL,
        montant REAL NOT NULL,
        mode TEXT,
        reference TEXT,
        notes TEXT,${HORODATAGE}
      )`,
      `CREATE INDEX idx_paiement_echeance ON paiement(echeance_id)`,
    ],
  },
];

export async function migrer(db: SqlDriver, migrations: Migration[] = MIGRATIONS): Promise<number> {
  await db.execute('PRAGMA foreign_keys = ON');
  await db.execute(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    appliquee_le TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const rows = await db.select<{ v: number | null }>('SELECT MAX(version) AS v FROM _migrations');
  const actuelle = rows[0]?.v ?? 0;
  let appliquees = 0;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= actuelle) continue;
    for (const sql of m.instructions) await db.execute(sql);
    await db.execute('INSERT INTO _migrations (version, nom) VALUES (?, ?)', [m.version, m.nom]);
    appliquees++;
  }
  return appliquees;
}
