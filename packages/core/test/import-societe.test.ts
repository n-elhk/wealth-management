import { describe, expect, it } from 'vitest';
import {
  analyserReponseSociete,
  promptExtractionSociete,
  rapprocherSociete,
  selectionnerPassagesSociete,
} from '../src/import/societe.js';

describe('promptExtractionSociete', () => {
  it('suit le format Mistral Instruct et décrit les champs à partir du schéma zod', () => {
    const prompt = promptExtractionSociete('  Statuts  ');
    expect(prompt.startsWith('[INST]')).toBe(true);
    expect(prompt.endsWith('[/INST]')).toBe(true);
    expect(prompt).toContain('"""\nStatuts\n"""');
    expect(prompt).toContain('"forme_juridique": "SCI" | "SARL"');
    expect(prompt).toContain('"capital": nombre | null // capital social, en euros');
    expect(prompt).toContain('"associes": [{');
  });
});

describe('selectionnerPassagesSociete', () => {
  it('garde le début et les paragraphes utiles aux statuts', () => {
    const remplissage = Array.from({ length: 40 }, (_, i) => `Clause générale numéro ${i} sans intérêt particulier.`);
    const texte = ['STATUTS DE LA SCI DUPONT', ...remplissage, 'Le capital social est fixé à 1 000 euros.'].join('\n\n');
    const r = selectionnerPassagesSociete(texte, 300);
    expect(r.startsWith('STATUTS DE LA SCI DUPONT')).toBe(true);
    expect(r).toContain('capital social');
    expect(r.length).toBeLessThanOrEqual(300);
  });

  it('ne retient pas « forme » ou « parts » à l’intérieur d’autres mots', () => {
    const remplissage = Array.from({ length: 40 }, (_, i) => `Clause générale numéro ${i} sans intérêt particulier.`);
    const pieges = ['Le bien est conforme aux normes.', 'Date de départ du preneur.', 'Les transactions passées.'];
    const texte = ['STATUTS', ...remplissage, ...pieges, 'Les parts sociales sont réparties ainsi.'].join('\n\n');
    const r = selectionnerPassagesSociete(texte, 300);
    expect(r).toContain('parts sociales');
    for (const p of pieges) expect(r).not.toContain(p);
  });
});

describe('analyserReponseSociete', () => {
  it('normalise les valeurs et garde les associés', () => {
    const { donnees, champsIgnores } = analyserReponseSociete(`\`\`\`json
{
  "raison_sociale": "SCI Dupont",
  "forme_juridique": "SCI",
  "siren": "RCS Lyon 123 456 789",
  "date_creation": "15/03/2021",
  "date_cloture_exercice": "31/12",
  "capital": "1 000,00 €",
  "nombre_parts": "100",
  "regime_fiscal": "IR",
  "associes": [
    { "civilite": "M.", "nom": "Dupont", "prenom": "Jean", "nombre_parts": 60, "est_gerant": "oui" },
    { "nom": "Dupont", "prenom": "Marie", "nombre_parts": 40, "est_gerant": false }
  ]
}
\`\`\``);
    expect(champsIgnores).toEqual([]);
    expect(donnees).toMatchObject({
      raison_sociale: 'SCI Dupont',
      siren: '123456789',
      date_creation: '2021-03-15',
      capital: 1000,
      nombre_parts: 100,
      rcs_ville: null,
    });
    expect(donnees.associes).toHaveLength(2);
    expect(donnees.associes[0]).toMatchObject({ prenom: 'Jean', nombre_parts: 60, est_gerant: true, civilite: 'M.' });
  });

  it('écarte les champs invalides sans perdre le reste', () => {
    const { donnees, champsIgnores } = analyserReponseSociete(
      '{"raison_sociale": "SCI X", "forme_juridique": "GIE", "siren": "1234", "associes": [{"nom": "Martin", "nombre_parts": -3}, {"prenom": "Sans nom"}]}',
    );
    expect(donnees.raison_sociale).toBe('SCI X');
    expect(donnees.forme_juridique).toBeNull();
    expect(donnees.siren).toBeNull();
    expect(donnees.associes).toEqual([{ civilite: null, nom: 'Martin', prenom: null, nombre_parts: null, est_gerant: null }]);
    expect(champsIgnores).toEqual(expect.arrayContaining(['forme_juridique', 'siren', 'associes[0].nombre_parts']));
  });
});

describe('rapprocherSociete', () => {
  const societes = [
    { id: 1, raison_sociale: 'SCI Les Tilleuls', siren: '123 456 789' },
    { id: 2, raison_sociale: 'SCI Dupont', siren: null },
  ];

  it('reconnaît une société par son SIREN', () => {
    expect(rapprocherSociete({ raison_sociale: 'Autre nom', siren: '123456789' }, societes)?.id).toBe(1);
  });

  it('reconnaît une société par sa raison sociale, sans tenir compte des accents ni de la casse', () => {
    expect(rapprocherSociete({ raison_sociale: 'sci DUPONT', siren: null }, societes)?.id).toBe(2);
    expect(rapprocherSociete({ raison_sociale: 'SCI Inconnue', siren: null }, societes)).toBeNull();
  });
});
