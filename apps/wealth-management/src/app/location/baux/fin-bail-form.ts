import { Component, inject, input, output, signal } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { BailSchema, ISODateSchema, aujourdhui, type Bail } from '@wealth-management/core';
import { z } from 'zod';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Notifications } from '../../ui/notifications.service';
import { AccessibiliteChamp, ErreurChamp, sansVides, schemaModele } from '../../ui/formulaire/saisie';

interface ModeleFin {
  date_sortie: string;
  motif_sortie: string;
}

const SCHEMA = schemaModele(
  (m: ModeleFin) => sansVides(m),
  z.object({ date_sortie: ISODateSchema, motif_sortie: BailSchema.shape.motif_sortie }),
);

/** Fin d'un bail actif (départ du locataire). */
@Component({
  selector: 'app-fin-bail-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp],
  template: `
    <form class="imbrique" (submit)="terminer($event)" novalidate autocomplete="off">
      <div class="grille-champs">
        <label class="champ l2">
          <span>Date de sortie (remise des clés)<b class="requis">*</b></span>
          <input aria-required="true" type="date" [formField]="f.date_sortie" />
          <app-erreur [champ]="f.date_sortie" />
        </label>
        <label class="champ l4">
          <span>Motif</span>
          <input [formField]="f.motif_sortie" placeholder="Congé du locataire, vente…" />
        </label>
      </div>
      <div class="actions-formulaire">
        <button type="button" class="btn" (click)="annule.emit()">Annuler</button>
        <button type="submit" class="btn primaire" [disabled]="f().submitting()">Terminer le bail</button>
      </div>
    </form>
  `,
})
export class FinBailForm {
  readonly bail = input.required<Bail>();
  readonly enregistre = output<void>();
  readonly annule = output<void>();

  private readonly bdd = inject(BaseDeDonnees);
  private readonly notifications = inject(Notifications);

  protected readonly modele = signal<ModeleFin>({ date_sortie: aujourdhui(), motif_sortie: '' });
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  protected terminer(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        // La cohérence avec la date de début est vérifiée par le schéma du bail.
        await this.bdd.depot.baux.modifier(this.bail().id, { statut: 'termine', ...SCHEMA.parse(this.modele()) });
        this.notifications.succes('Bail terminé');
        this.enregistre.emit();
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }
}
