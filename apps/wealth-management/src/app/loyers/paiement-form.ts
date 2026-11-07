import { Component, inject, input, linkedSignal, output } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { OPTIONS, PaiementSaisieSchema, arrondi, aujourdhui, totalEcheance, type ModePaiement } from '@wealth-management/core';
import type { EcheanceSuivi } from '@wealth-management/db';
import { BaseDeDonnees } from '../infrastructure/base-de-donnees.service';
import { Notifications } from '../ui/notifications.service';
import { AccessibiliteChamp, ErreurChamp, nombre, sansVides, schemaModele, texte } from '../ui/formulaire/saisie';

interface ModelePaiement {
  date_paiement: string;
  montant: string;
  mode: string;
  reference: string;
  notes: string;
}

const SCHEMA = schemaModele(
  (m: ModelePaiement) => ({ ...sansVides(m), montant: nombre(m.montant) }),
  PaiementSaisieSchema.omit({ echeance_id: true }),
);

/** Saisie d'un paiement (partiel ou d'un autre montant) sur une échéance. */
@Component({
  selector: 'app-paiement-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp],
  template: `
    <form class="imbrique" (submit)="enregistrer($event)" novalidate autocomplete="off">
      <div class="grille-champs">
        <label class="champ l2">
          <span>Date<b class="requis">*</b></span>
          <input aria-required="true" type="date" [formField]="f.date_paiement" />
          <app-erreur [champ]="f.date_paiement" />
        </label>
        <label class="champ l2">
          <span>Montant<b class="requis">*</b></span>
          <div class="saisie" data-suffixe="€">
            <input aria-required="true" type="text" inputmode="decimal" [formField]="f.montant" />
          </div>
          <app-erreur [champ]="f.montant" />
        </label>
        <label class="champ l2">
          <span>Mode</span>
          <select [formField]="f.mode">
            <option value="">—</option>
            @for (o of options.modePaiement; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        </label>
        <label class="champ l3">
          <span>Référence</span>
          <input [formField]="f.reference" />
        </label>
        <label class="champ l3">
          <span>Notes</span>
          <input [formField]="f.notes" />
        </label>
      </div>
      <div class="actions-formulaire">
        <button type="button" class="btn" (click)="annule.emit()">Annuler</button>
        <button type="submit" class="btn primaire" [disabled]="f().submitting()">Enregistrer le paiement</button>
      </div>
    </form>
  `,
})
export class PaiementForm {
  readonly echeance = input.required<EcheanceSuivi>();
  /** Mode de paiement habituel du bail, proposé par défaut. */
  readonly modeParDefaut = input<ModePaiement | null>(null);
  readonly enregistre = output<void>();
  readonly annule = output<void>();

  private readonly bdd = inject(BaseDeDonnees);
  private readonly notifications = inject(Notifications);

  protected readonly options = OPTIONS;

  /** Valeurs proposées : le reste dû de l'échéance, payé aujourd'hui. */
  protected readonly modele = linkedSignal<ModelePaiement>(() => {
    const e = this.echeance();
    return {
      date_paiement: aujourdhui(),
      montant: texte(arrondi(totalEcheance(e) - e.total_paye)),
      mode: this.modeParDefaut() ?? 'virement',
      reference: '',
      notes: '',
    };
  });
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  protected enregistrer(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        await this.bdd.depot.loyers.paiements.creer({ ...SCHEMA.parse(this.modele()), echeance_id: this.echeance().id });
        this.notifications.succes('Paiement enregistré');
        this.enregistre.emit();
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }
}
