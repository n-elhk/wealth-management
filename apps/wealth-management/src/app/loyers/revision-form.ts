import { Component, inject, input, linkedSignal, output } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { RevisionLoyerSaisieSchema, aujourdhui, calculerRevisionIRL, prochaineDateRevision, type Bail } from '@wealth-management/core';
import { BaseDeDonnees } from '../infrastructure/base-de-donnees.service';
import { Notifications } from '../ui/notifications.service';
import { AccessibiliteChamp, ErreurChamp, nombre, sansVides, schemaModele, texte } from '../ui/formulaire/saisie';

interface ModeleRevision {
  date_effet: string;
  irl_trimestre: string;
  irl_nouveau: string;
  nouveau_loyer: string;
  notes: string;
}

const SCHEMA = schemaModele(
  (m: ModeleRevision) => ({ ...sansVides(m), irl_nouveau: nombre(m.irl_nouveau), nouveau_loyer: nombre(m.nouveau_loyer) }),
  RevisionLoyerSaisieSchema.pick({ date_effet: true, nouveau_loyer: true, irl_trimestre: true, irl_nouveau: true, notes: true }),
);

/** Révision annuelle du loyer d'un bail (IRL). */
@Component({
  selector: 'app-revision-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp],
  template: `
    <form class="imbrique" (submit)="reviser($event)" novalidate autocomplete="off">
      <div class="grille-champs">
        <label class="champ l2">
          <span>Date d’effet<b class="requis">*</b></span>
          <input aria-required="true" type="date" [formField]="f.date_effet" />
          <app-erreur [champ]="f.date_effet" />
        </label>
        <label class="champ l2">
          <span>Trimestre IRL</span>
          <input [formField]="f.irl_trimestre" placeholder="T2 2026" />
          <app-erreur [champ]="f.irl_trimestre" />
        </label>
        <label class="champ l2">
          <span>Nouvel indice IRL</span>
          <input type="text" inputmode="decimal" [formField]="f.irl_nouveau" (input)="recalculerLoyer($any($event.target).value)" />
          <app-erreur [champ]="f.irl_nouveau" />
        </label>
        <label class="champ l2">
          <span>Nouveau loyer HC<b class="requis">*</b></span>
          <div class="saisie" data-suffixe="€">
            <input aria-required="true" type="text" inputmode="decimal" [formField]="f.nouveau_loyer" />
          </div>
          <app-erreur [champ]="f.nouveau_loyer" />
        </label>
        <label class="champ l4">
          <span>Notes</span>
          <input [formField]="f.notes" />
        </label>
      </div>
      <div class="actions-formulaire">
        <button type="button" class="btn" (click)="annule.emit()">Annuler</button>
        <button type="submit" class="btn primaire" [disabled]="f().submitting()">Appliquer la révision</button>
      </div>
    </form>
  `,
})
export class RevisionForm {
  readonly bail = input.required<Bail>();
  readonly enregistre = output<void>();
  readonly annule = output<void>();

  private readonly bdd = inject(BaseDeDonnees);
  private readonly notifications = inject(Notifications);
  private readonly jour = aujourdhui();

  /** Valeurs proposées à partir du bail : prochaine date anniversaire et loyer actuel. */
  protected readonly modele = linkedSignal<ModeleRevision>(() => {
    const bail = this.bail();
    return {
      date_effet: prochaineDateRevision(bail.date_debut, this.jour),
      irl_trimestre: '',
      irl_nouveau: '',
      nouveau_loyer: texte(bail.loyer_hc),
      notes: '',
    };
  });
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  /** Nouveau loyer = loyer × nouvel IRL ÷ IRL de référence (reste modifiable à la main). */
  protected recalculerLoyer(saisie: string) {
    const bail = this.bail();
    const irl = nombre(saisie);
    if (!irl || !bail.irl_valeur_reference) return;
    const loyer = calculerRevisionIRL(bail.loyer_hc, bail.irl_valeur_reference, irl);
    this.modele.update((m) => ({ ...m, nouveau_loyer: texte(loyer) }));
  }

  protected reviser(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        await this.bdd.depot.loyers.appliquerRevision(this.bail(), SCHEMA.parse(this.modele()), this.jour);
        this.notifications.succes('Révision appliquée aux échéances non payées');
        this.enregistre.emit();
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }
}
