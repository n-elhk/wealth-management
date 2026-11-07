import { Component, computed, input } from '@angular/core';
import { LIBELLES_STATUT_BAIL, type StatutBail } from '@wealth-management/core';

const COULEURS: Record<StatutBail, string> = {
  actif: 'vert',
  brouillon: 'orange',
  termine: 'gris',
};

/** Badge du statut d'un bail. */
@Component({
  selector: 'app-statut-bail',
  template: `<span [class]="'badge ' + couleur()">{{ libelle() }}</span>`,
})
export class BadgeStatutBail {
  readonly statut = input.required<StatutBail>();
  protected readonly libelle = computed(() => LIBELLES_STATUT_BAIL[this.statut()]);
  protected readonly couleur = computed(() => COULEURS[this.statut()]);
}
