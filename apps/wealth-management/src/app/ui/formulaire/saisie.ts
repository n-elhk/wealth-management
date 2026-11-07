import { Component, Directive, computed, inject, input } from '@angular/core';
import { FormField, type FieldTree, type IgnoreUnknownProperties, type validateStandardSchema } from '@angular/forms/signals';
import { z } from 'zod';

/**
 * Outils communs aux formulaires Signal Forms.
 *
 * Les modèles de formulaire ne contiennent que des chaînes (champs de saisie, listes) et des booléens (cases) :
 * jamais de `null`. Chaque formulaire convertit son modèle en données de saisie (`versSaisie`) avant de les
 * valider avec le schéma zod de `@wealth-management/core`, via `schemaModele` et `validateStandardSchema`.
 */

/** Schéma « Standard Schema » accepté par `validateStandardSchema` pour un modèle `M`. */
type StandardSchema<M> = Extract<Parameters<typeof validateStandardSchema<M, IgnoreUnknownProperties<M>>>[1], { readonly '~standard': unknown }>;

/** Validation d'un modèle de formulaire par un schéma métier zod. */
export interface SchemaModele<M, O> {
  /** À passer à `validateStandardSchema` : les erreurs sont rattachées aux champs de même nom. */
  readonly validation: StandardSchema<M>;
  /** Convertit et valide le modèle ; renvoie les données normalisées (lève une erreur si invalide). */
  parse(m: M): O;
}

/** Associe la conversion d'un modèle (`versSaisie`) et le schéma métier qui valide le résultat. */
export function schemaModele<M, S extends z.ZodType>(versSaisie: (m: M) => unknown, schema: S): SchemaModele<M, z.output<S>> {
  const pipe = z.preprocess((m) => versSaisie(m as M), schema);
  return {
    validation: pipe as unknown as StandardSchema<M>,
    parse: (m) => pipe.parse(m) as z.output<S>,
  };
}

/** Valeur métier → texte de saisie (`''` pour une valeur absente). */
export function texte(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Construit un modèle texte à partir d'une entité (ou de valeurs par défaut). */
export function textes<K extends string>(cles: readonly K[], source?: object | null): Record<K, string> {
  const s = (source ?? {}) as Record<string, unknown>;
  return Object.fromEntries(cles.map((c) => [c, texte(s[c])])) as Record<K, string>;
}

/** Remplace les chaînes vides (ou blanches) par `null`, comme attendu par les schémas zod. */
export function sansVides<M extends object>(m: M): { [K in keyof M]: M[K] extends string ? string | null : M[K] } {
  return Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]),
  ) as { [K in keyof M]: M[K] extends string ? string | null : M[K] };
}

/**
 * Texte saisi → nombre (`null` si vide, `NaN` si invalide : rejeté par le schéma).
 * Accepte la virgule décimale et les espaces de milliers (« 1 250,50 ») : les montants sont des
 * `<input type="text" inputmode="decimal">`, car `type="number"` rejette la virgule sous WebKit en français.
 */
export function nombre(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.');
  return t === '' ? null : Number(t);
}

/** Case à cocher → booléen SQLite. */
export function bool(b: boolean): 0 | 1 {
  return b ? 1 : 0;
}

/** État d'un champ Signal Forms, réduit à ce qu'il faut pour afficher son erreur. */
interface EtatChamp {
  touched(): boolean;
  errors(): readonly { message?: string }[];
}

/** Premier message d'erreur d'un champ, une fois le champ touché (ou après une tentative d'envoi). */
function messageErreur(etat: EtatChamp): string | null {
  if (!etat.touched()) return null;
  const e = etat.errors()[0];
  return e ? (e.message ?? 'Valeur invalide') : null;
}

/** Identifiant du message d'erreur d'un champ, partagé par `app-erreur` et `AccessibiliteChamp` (l'état est stable). */
const idsErreur = new WeakMap<EtatChamp, string>();
let compteurErreurs = 0;
function idErreur(etat: EtatChamp): string {
  let id = idsErreur.get(etat);
  if (!id) idsErreur.set(etat, (id = `erreur-champ-${++compteurErreurs}`));
  return id;
}

/** Message d'erreur d'un champ. */
@Component({
  selector: 'app-erreur',
  template: `
    @if (message(); as m) {
      <!-- aria-hidden : le message est dans le <label>, on l'exclut du nom accessible du champ ;
           il reste annoncé comme description via aria-describedby (référence directe). -->
      <small class="erreur" [id]="id()" aria-hidden="true">{{ m }}</small>
    }
  `,
})
export class ErreurChamp {
  readonly champ = input.required<FieldTree<string> | FieldTree<boolean>>();

  private readonly etat = computed(() => this.champ()());
  protected readonly message = computed(() => messageErreur(this.etat()));
  protected readonly id = computed(() => idErreur(this.etat()));
}

/**
 * Expose l'état d'erreur d'un champ aux technologies d'assistance — Signal Forms ne le fait pas :
 * `aria-invalid` et `aria-describedby` (vers le message de `app-erreur`) dès que l'erreur est affichée.
 */
@Directive({
  selector: 'input[formField], select[formField], textarea[formField]',
  host: {
    '[attr.aria-invalid]': 'erreur() ? "true" : null',
    '[attr.aria-describedby]': 'erreur() ? id() : null',
  },
})
export class AccessibiliteChamp {
  private readonly formField = inject(FormField);
  private readonly etat = computed(() => this.formField.field()() as EtatChamp);
  protected readonly erreur = computed(() => messageErreur(this.etat()) !== null);
  protected readonly id = computed(() => idErreur(this.etat()));
}
