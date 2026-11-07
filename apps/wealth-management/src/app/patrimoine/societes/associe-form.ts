import { Component, inject, input, output, signal } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { AssocieSaisieSchema, OPTIONS } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Notifications } from '../../ui/notifications.service';
import { AccessibiliteChamp, ErreurChamp, bool, nombre, sansVides, schemaModele } from '../../ui/formulaire/saisie';

interface ModeleAssocie {
  civilite: string;
  prenom: string;
  nom: string;
  nombre_parts: string;
  date_entree: string;
  est_gerant: boolean;
}

const SCHEMA = schemaModele(
  (m: ModeleAssocie) => ({ ...sansVides(m), nombre_parts: nombre(m.nombre_parts), est_gerant: bool(m.est_gerant) }),
  AssocieSaisieSchema.omit({ societe_id: true }),
);

/** Ajout d'un associé à une société. */
@Component({
  selector: 'app-associe-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp],
  template: `
    <form class="imbrique" (submit)="ajouter($event)" novalidate autocomplete="off">
      <div class="grille-champs">
        <label class="champ l1">
          <span>Civilité</span>
          <select [formField]="f.civilite">
            <option value="">—</option>
            @for (o of options.civilite; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        </label>
        <label class="champ l2">
          <span>Prénom</span>
          <input [formField]="f.prenom" />
        </label>
        <label class="champ l3">
          <span>Nom<b class="requis">*</b></span>
          <input aria-required="true" [formField]="f.nom" />
          <app-erreur [champ]="f.nom" />
        </label>
        <label class="champ l2">
          <span>Nombre de parts<b class="requis">*</b></span>
          <input aria-required="true" type="text" inputmode="numeric" [formField]="f.nombre_parts" />
          <app-erreur [champ]="f.nombre_parts" />
        </label>
        <label class="champ l2">
          <span>Date d’entrée</span>
          <input type="date" [formField]="f.date_entree" />
          <app-erreur [champ]="f.date_entree" />
        </label>
        <label class="champ case l2">
          <input type="checkbox" [formField]="f.est_gerant" />
          <span>Gérant</span>
        </label>
      </div>
      <div class="actions-formulaire">
        <button type="button" class="btn" (click)="annule.emit()">Annuler</button>
        <button type="submit" class="btn primaire" [disabled]="f().submitting()">Ajouter</button>
      </div>
    </form>
  `,
})
export class AssocieForm {
  readonly societeId = input.required<number>();
  readonly enregistre = output<void>();
  readonly annule = output<void>();

  private readonly bdd = inject(BaseDeDonnees);
  private readonly notifications = inject(Notifications);

  protected readonly options = OPTIONS;
  protected readonly modele = signal<ModeleAssocie>({
    civilite: '', prenom: '', nom: '', nombre_parts: '0', date_entree: '', est_gerant: false,
  });
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  protected ajouter(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        await this.bdd.depot.societes.associes.creer({ ...SCHEMA.parse(this.modele()), societe_id: this.societeId() });
        this.enregistre.emit();
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }
}
