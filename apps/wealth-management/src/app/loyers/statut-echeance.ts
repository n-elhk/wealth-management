import { Component, computed, input } from '@angular/core';
import { LIBELLES_STATUT_ECHEANCE, type StatutEcheance } from '@wealth-management/core';

const COULEURS: Partial<Record<StatutEcheance, string>> = {
  payee: 'vert',
  partielle: 'orange',
  trop_percu: 'orange',
  en_retard: 'rouge',
};

/** Badge du statut d'une échéance de loyer. */
@Component({
  selector: 'app-statut-echeance',
  template: `<span [class]="'badge ' + couleur()">{{ libelle() }}</span>`,
})
export class BadgeStatutEcheance {
  readonly statut = input.required<StatutEcheance>();
  protected readonly libelle = computed(() => LIBELLES_STATUT_ECHEANCE[this.statut()]);
  protected readonly couleur = computed(() => COULEURS[this.statut()] ?? 'gris');
}
