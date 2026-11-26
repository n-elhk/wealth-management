import { describe, expect, it } from 'vitest';
import {
  analyserReponseBail,
  extraireObjetJson,
  promptExtractionBail,
  rapprocherBien,
  rapprocherLocataire,
  selectionnerPassages,
} from '../src/import/bail.js';

describe('promptExtractionBail', () => {
  it('suit le format Mistral Instruct et décrit les champs à partir du schéma zod', () => {
    const prompt = promptExtractionBail('  Contrat de location  ');
    expect(prompt.startsWith('[INST]')).toBe(true);
    expect(prompt.endsWith('[/INST]')).toBe(true);
    expect(prompt).toContain('"""\nContrat de location\n"""');
    expect(prompt).toContain('"type_bail": "habitation_vide" | "habitation_meuble"');
    expect(prompt).toContain('"loyer_hc": nombre | null // loyer mensuel hors charges, en euros');
    expect(prompt).toContain('"date_debut": "AAAA-MM-JJ" | null');
    expect(prompt).toContain('"tacite_reconduction": true|false | null');
    expect(prompt).toContain('"locataires": [{');
    expect(prompt).toContain('"nom": texte // nom de famille');
  });
});

describe('selectionnerPassages', () => {
  it('rend le texte tel quel s’il tient dans le budget', () => {
    expect(selectionnerPassages('a\n\n\n\nb', 100)).toBe('a\n\nb');
  });

  it('garde le début puis les paragraphes pertinents, dans l’ordre', () => {
    const remplissage = Array.from({ length: 30 }, (_, i) => `Article ${i} sans intérêt particulier pour nous.`);
    const texte = ['ENTRE LES SOUSSIGNÉS', ...remplissage.slice(0, 15), 'Le loyer mensuel est fixé à 850 €.', ...remplissage.slice(15), 'Dépôt de garantie : 850 €.'].join('\n\n');
    const r = selectionnerPassages(texte, 300);
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.startsWith('ENTRE LES SOUSSIGNÉS')).toBe(true);
    expect(r.indexOf('loyer mensuel')).toBeGreaterThan(0);
    expect(r.indexOf('loyer mensuel')).toBeLessThan(r.indexOf('Dépôt de garantie'));
    expect(r).not.toContain('Article 20');
  });
});

describe('extraireObjetJson', () => {
  it('isole le premier objet, y compris entouré de texte ou de ```json', () => {
    expect(extraireObjetJson('Voici :\n```json\n{"a": "}", "b": {"c": 1}}\n```\n{"d": 2}')).toEqual({ a: '}', b: { c: 1 } });
  });
  it('rejette une réponse sans JSON valide', () => {
    expect(() => extraireObjetJson('aucune donnée')).toThrow();
    expect(() => extraireObjetJson('{"a": 1,}')).toThrow();
  });
});

describe('analyserReponseBail', () => {
  it('normalise les formats courants et valide avec zod', () => {
    const r = analyserReponseBail(`\`\`\`json
{
  "type_bail": "habitation_meuble",
  "date_signature": "15/08/2025",
  "date_debut": "2025-09-01",
  "duree_mois": "12",
  "tacite_reconduction": "oui",
  "loyer_hc": "1 250,50 €",
  "charges": 80,
  "mode_charges": "provision",
  "depot_garantie": 2501,
  "jour_paiement": 5,
  "paiement_terme": "echoir",
  "mode_paiement": "virement",
  "irl_trimestre_reference": "T2 2025",
  "irl_valeur_reference": 145.17,
  "zone_tendue": false,
  "loyer_reference_majore": null,
  "complement_loyer": null,
  "dernier_loyer_precedent": null,
  "destination": "Usage exclusif d'habitation principale",
  "bien": { "adresse_ligne1": "12 bd Voltaire", "code_postal": "75011", "ville": "Paris" },
  "locataires": [{ "civilite": "Mme", "nom": "Martin", "prenom": "Léa", "date_naissance": "03/02/1995", "lieu_naissance": "Lyon", "email": "", "telephone": null, "profession": "Infirmière" }]
}
\`\`\``);
    expect(r.champsIgnores).toEqual([]);
    expect(r.donnees).toMatchObject({
      date_signature: '2025-08-15',
      duree_mois: 12,
      tacite_reconduction: true,
      loyer_hc: 1250.5,
      bien: { ville: 'Paris' },
      locataires: [{ nom: 'Martin', prenom: 'Léa', date_naissance: '1995-02-03', email: null }],
    });
  });

  it('ignore les champs invalides au lieu de tout rejeter', () => {
    const r = analyserReponseBail(
      '{"type_bail": "location", "loyer_hc": 700, "jour_paiement": 45, "locataires": [{"nom": "Durand", "prenom": "Paul", "civilite": "Monsieur"}, {"prenom": "Sans nom"}]}',
    );
    expect(r.donnees.type_bail).toBeNull();
    expect(r.donnees.jour_paiement).toBeNull();
    expect(r.donnees.loyer_hc).toBe(700);
    expect(r.donnees.bien).toBeNull();
    expect(r.donnees.locataires).toEqual([expect.objectContaining({ nom: 'Durand', prenom: 'Paul', civilite: null })]);
    expect(r.champsIgnores).toEqual(expect.arrayContaining(['type_bail', 'jour_paiement', 'locataires[0].civilite']));
  });
});

describe('rapprochements', () => {
  const biens = [
    { id: 1, adresse_ligne1: '12 boulevard Voltaire', code_postal: '75011', ville: 'Paris' },
    { id: 2, adresse_ligne1: '3 rue de la Paix', code_postal: '75002', ville: 'Paris' },
  ];

  it('retrouve un bien malgré les abréviations et les accents', () => {
    expect(rapprocherBien({ adresse_ligne1: '12, Bd Voltaire', code_postal: '75011', ville: 'PARIS' }, biens)?.id).toBe(1);
    expect(rapprocherBien({ adresse_ligne1: '12 bd Voltaire', code_postal: '69001', ville: 'Lyon' }, biens)).toBeNull();
    expect(rapprocherBien(null, biens)).toBeNull();
  });

  it('retrouve un locataire par nom et prénom', () => {
    const locataires = [
      { id: 1, nom: 'Martin', prenom: 'Jean' },
      { id: 2, nom: 'MARTIN', prenom: 'Léa' },
    ];
    const extrait = { civilite: null, nom: 'martin', prenom: 'Lea', date_naissance: null, lieu_naissance: null, email: null, telephone: null, profession: null };
    expect(rapprocherLocataire(extrait, locataires)?.id).toBe(2);
    expect(rapprocherLocataire({ ...extrait, prenom: null }, locataires)).toBeNull();
  });
});
