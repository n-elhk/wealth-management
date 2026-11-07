import { describe, expect, it } from 'vitest';
import { formeJuridiqueDepuisCategorie, normaliserSiren, societeDepuisRegistre, urlRechercheSiren } from '../src/index.js';

const REPONSE = {
  results: [
    {
      siren: '999999999',
      nom_raison_sociale: 'AUTRE SOCIETE',
    },
    {
      siren: '123456789',
      nom_complet: 'SCI LES TILLEULS',
      nom_raison_sociale: 'SCI LES TILLEULS',
      nature_juridique: '6540',
      date_creation: '2015-03-12',
      siege: {
        numero_voie: '12',
        indice_repetition: 'B',
        type_voie: 'AV',
        libelle_voie: 'DU GENERAL DE GAULLE',
        complement_adresse: 'RESIDENCE LE PARC',
        code_postal: '42000',
        libelle_commune: 'SAINT-ETIENNE',
        libelle_pays_etranger: null,
        champ_inconnu: 'ignoré',
      },
      dirigeants: [
        { type_dirigeant: 'personne morale', denomination: 'HOLDING X', qualite: 'Associé' },
        { type_dirigeant: 'personne physique', nom: 'DUPONT', prenoms: 'JEAN-PIERRE', qualite: 'Gérant' },
      ],
    },
  ],
  total_results: 2,
};

describe('registre des entreprises', () => {
  it('normalise le SIREN', () => {
    expect(normaliserSiren('123 456 789')).toBe('123456789');
    expect(normaliserSiren('12345678')).toBeNull();
    expect(normaliserSiren(null)).toBeNull();
    expect(urlRechercheSiren('123456789')).toContain('q=123456789');
  });

  it('convertit la catégorie juridique INSEE', () => {
    expect(formeJuridiqueDepuisCategorie('6540')).toBe('SCI');
    expect(formeJuridiqueDepuisCategorie('5720')).toBe('SASU');
    expect(formeJuridiqueDepuisCategorie('9220')).toBe('AUTRE');
    expect(formeJuridiqueDepuisCategorie(null)).toBe('AUTRE');
  });

  it('pré-remplit la société correspondant exactement au SIREN', () => {
    expect(societeDepuisRegistre(REPONSE, '123456789')).toEqual({
      siren: '123 456 789',
      raison_sociale: 'SCI LES TILLEULS',
      forme_juridique: 'SCI',
      date_creation: '2015-03-12',
      adresse_ligne1: '12 bis avenue du General de Gaulle',
      adresse_ligne2: 'Residence le Parc',
      code_postal: '42000',
      ville: 'Saint-Etienne',
      pays: 'France',
      representant_nom: 'Jean-Pierre DUPONT',
      representant_qualite: 'Gérant',
    });
  });

  it('renvoie null si le SIREN est absent ou la réponse invalide', () => {
    expect(societeDepuisRegistre(REPONSE, '111111111')).toBeNull();
    expect(societeDepuisRegistre({ results: [] }, '123456789')).toBeNull();
    expect(societeDepuisRegistre('<html>', '123456789')).toBeNull();
    expect(societeDepuisRegistre(null, '123456789')).toBeNull();
  });
});
