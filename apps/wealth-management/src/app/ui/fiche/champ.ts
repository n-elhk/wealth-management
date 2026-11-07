import type { Option } from '@wealth-management/core';

export type TypeChamp = 'texte' | 'nombre' | 'montant' | 'date' | 'select' | 'zone' | 'case' | 'email' | 'tel';

export type Valeurs = Record<string, unknown>;

/** Description déclarative d'un champ affiché dans une fiche de détail (`app-fiche`). */
export interface Champ {
  cle: string;
  libelle: string;
  type: TypeChamp;
  section?: string;
  options?: Option<string | number>[];
  /** Largeur sur une grille de 6 colonnes (défaut : 3, soit une demi-ligne). */
  largeur?: 1 | 2 | 3 | 4 | 6;
  suffixe?: string;
  visible?: (v: Valeurs) => boolean;
}

/** Regroupe les champs par section en conservant l'ordre de déclaration. */
export function parSection(champs: Champ[]): { titre: string; champs: Champ[] }[] {
  const sections: { titre: string; champs: Champ[] }[] = [];
  for (const c of champs) {
    const titre = c.section ?? '';
    let s = sections.find((x) => x.titre === titre);
    if (!s) sections.push((s = { titre, champs: [] }));
    s.champs.push(c);
  }
  return sections;
}
