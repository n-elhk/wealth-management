import { Component, computed, input } from '@angular/core';
import { formatDateFr, formatEuro } from '@wealth-management/core';
import { parSection, type Champ, type Valeurs } from './champ';

/** Affichage en lecture seule d'une entité à partir de ses `Champ`. */
@Component({
  selector: 'app-fiche',
  styleUrl: './fiche.component.css',
  template: `
    @for (s of sections(); track s.titre) {
      @if (s.lignes.length) {
        <section class="carte">
          @if (s.titre) {
            <h2>{{ s.titre }}</h2>
          }
          <dl class="fiche">
            @for (l of s.lignes; track l.libelle) {
              <div [class]="'l' + l.largeur">
                <dt>{{ l.libelle }}</dt>
                <dd [class.multiligne]="l.multiligne">{{ l.valeur }}</dd>
              </div>
            }
          </dl>
        </section>
      }
    }
  `,
})
export class Fiche {
  readonly champs = input.required<Champ[]>();
  readonly valeur = input.required<Valeurs>();

  readonly sections = computed(() => {
    const v = this.valeur();
    return parSection(this.champs()).map((s) => ({
      titre: s.titre,
      lignes: s.champs
        .filter((c) => (!c.visible || c.visible(v)) && afficher(c, v[c.cle]))
        .map((c) => ({
          libelle: c.libelle,
          valeur: formater(c, v[c.cle]),
          largeur: c.type === 'zone' ? 6 : Math.min(c.largeur ?? 2, 3),
          multiligne: c.type === 'zone',
        })),
    }));
  });
}

function afficher(c: Champ, v: unknown): boolean {
  if (c.type === 'case') return v === 1 || v === true;
  return v !== null && v !== undefined && v !== '';
}

function formater(c: Champ, v: unknown): string {
  switch (c.type) {
    case 'montant':
      return formatEuro(Number(v));
    case 'date':
      return formatDateFr(String(v));
    case 'case':
      return 'Oui';
    case 'select':
      return String(c.options?.find((o) => o.value === v)?.label ?? v);
    default:
      return `${v}${c.suffixe ? ` ${c.suffixe}` : ''}`;
  }
}
