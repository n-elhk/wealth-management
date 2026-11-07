import { Component, inject, input, output, signal } from '@angular/core';
import { FormField, form, hidden, submit, validateStandardSchema } from '@angular/forms/signals';
import { GarantSaisieSchema, OPTIONS } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Notifications } from '../../ui/notifications.service';
import { AccessibiliteChamp, ErreurChamp, nombre, sansVides, schemaModele, textes } from '../../ui/formulaire/saisie';

const CLES = [
  'type_garant', 'civilite', 'prenom', 'nom', 'date_naissance', 'adresse', 'email', 'telephone',
  'montant_engagement', 'duree_engagement', 'notes',
] as const;
type ModeleGarant = Record<(typeof CLES)[number], string>;

/** Les informations d'état civil ne concernent qu'un garant personne physique. */
const SCHEMA = schemaModele((m: ModeleGarant) => {
  const s = { ...sansVides(m), montant_engagement: nombre(m.montant_engagement) };
  return m.type_garant === 'personne' ? s : { ...s, civilite: null, prenom: null, date_naissance: null };
}, GarantSaisieSchema.omit({ bail_id: true }));

/** Ajout d'un garant (caution) à un bail. */
@Component({
  selector: 'app-garant-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp],
  template: `
    <form class="imbrique" (submit)="ajouter($event)" novalidate autocomplete="off">
      <div class="grille-champs">
        <label class="champ l2">
          <span>Type<b class="requis">*</b></span>
          <select aria-required="true" [formField]="f.type_garant">
            @for (o of options.typeGarant; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        </label>
        @if (!f.civilite().hidden()) {
          <label class="champ l1">
            <span>Civilité</span>
            <select [formField]="f.civilite">
              <option value="">—</option>
              @for (o of options.civilite; track o.value) {
                <option [value]="o.value">{{ o.label }}</option>
              }
            </select>
          </label>
          <label class="champ l1">
            <span>Prénom</span>
            <input [formField]="f.prenom" />
          </label>
        }
        <label class="champ l2">
          <span>Nom / n° de visa<b class="requis">*</b></span>
          <input aria-required="true" [formField]="f.nom" />
          <app-erreur [champ]="f.nom" />
        </label>
        @if (!f.date_naissance().hidden()) {
          <label class="champ l2">
            <span>Date de naissance</span>
            <input type="date" [formField]="f.date_naissance" />
            <app-erreur [champ]="f.date_naissance" />
          </label>
        }
        <label class="champ l4">
          <span>Adresse</span>
          <input [formField]="f.adresse" />
        </label>
        <label class="champ l2">
          <span>E-mail</span>
          <input type="email" autocapitalize="off" spellcheck="false" [formField]="f.email" />
          <app-erreur [champ]="f.email" />
        </label>
        <label class="champ l2">
          <span>Téléphone</span>
          <input type="tel" [formField]="f.telephone" />
        </label>
        <label class="champ l2">
          <span>Montant maximal garanti</span>
          <div class="saisie" data-suffixe="€">
            <input type="text" inputmode="decimal" [formField]="f.montant_engagement" />
          </div>
          <app-erreur [champ]="f.montant_engagement" />
        </label>
        <label class="champ l2">
          <span>Durée de l’engagement</span>
          <input [formField]="f.duree_engagement" placeholder="durée du bail + 1 renouvellement" />
        </label>
        <label class="champ l6">
          <span>Notes</span>
          <input [formField]="f.notes" />
        </label>
      </div>
      <div class="actions-formulaire">
        <button type="button" class="btn" (click)="annule.emit()">Annuler</button>
        <button type="submit" class="btn primaire" [disabled]="f().submitting()">Ajouter</button>
      </div>
    </form>
  `,
})
export class GarantForm {
  readonly bailId = input.required<number>();
  readonly enregistre = output<void>();
  readonly annule = output<void>();

  private readonly bdd = inject(BaseDeDonnees);
  private readonly notifications = inject(Notifications);

  protected readonly options = OPTIONS;
  protected readonly modele = signal<ModeleGarant>(textes(CLES, { type_garant: 'personne' }));
  protected readonly f = form(this.modele, (p) => {
    for (const champ of [p.civilite, p.prenom, p.date_naissance]) {
      hidden(champ, { when: ({ valueOf }) => valueOf(p.type_garant) !== 'personne' });
    }
    validateStandardSchema(p, SCHEMA.validation);
  });

  protected ajouter(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        await this.bdd.depot.baux.garants.creer({ ...SCHEMA.parse(this.modele()), bail_id: this.bailId() });
        this.enregistre.emit();
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }
}
