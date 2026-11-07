import { Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { LocataireSaisieSchema, OPTIONS } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Notifications } from '../../ui/notifications.service';
import { idRoute } from '../../ui/route';
import { AccessibiliteChamp, ErreurChamp, nombre, sansVides, schemaModele, textes } from '../../ui/formulaire/saisie';

const CLES = [
  'civilite', 'prenom', 'nom', 'date_naissance', 'lieu_naissance', 'nationalite', 'situation_familiale',
  'type_piece_identite', 'numero_piece_identite', 'email', 'telephone', 'adresse_precedente',
  'profession', 'employeur', 'revenus_mensuels', 'notes',
] as const;
type ModeleLocataire = Record<(typeof CLES)[number], string>;

const DEFAUTS = { nationalite: 'Française' };

const SCHEMA = schemaModele(
  (m: ModeleLocataire) => ({ ...sansVides(m), revenus_mensuels: nombre(m.revenus_mensuels) }),
  LocataireSaisieSchema,
);

@Component({
  selector: 'app-locataire-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp, RouterLink],
  template: `
    <header class="entete">
      <div>
        <a class="retour" [routerLink]="id() ? ['/locataires', id()] : '/locataires'">← Retour</a>
        <h1>{{ id() ? 'Modifier le locataire' : 'Nouveau locataire' }}</h1>
      </div>
    </header>

    @if (pret()) {
      <form (submit)="enregistrer($event)" novalidate autocomplete="off">
        <fieldset class="carte">
          <legend>État civil</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Civilité</span>
              <select [formField]="f.civilite">
                <option value="">—</option>
                @for (o of options.civilite; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Prénom<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.prenom" />
              <app-erreur [champ]="f.prenom" />
            </label>
            <label class="champ l2">
              <span>Nom<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.nom" />
              <app-erreur [champ]="f.nom" />
            </label>
            <label class="champ l2">
              <span>Date de naissance</span>
              <input type="date" [formField]="f.date_naissance" />
              <app-erreur [champ]="f.date_naissance" />
            </label>
            <label class="champ l2">
              <span>Lieu de naissance</span>
              <input [formField]="f.lieu_naissance" />
            </label>
            <label class="champ l2">
              <span>Nationalité</span>
              <input [formField]="f.nationalite" />
            </label>
            <label class="champ l3">
              <span>Situation familiale</span>
              <input [formField]="f.situation_familiale" />
            </label>
            <label class="champ l2">
              <span>Pièce d’identité</span>
              <input [formField]="f.type_piece_identite" placeholder="CNI, passeport…" />
            </label>
            <label class="champ l2">
              <span>N° de pièce</span>
              <input [formField]="f.numero_piece_identite" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Contact</legend>
          <div class="grille-champs">
            <label class="champ l3">
              <span>E-mail</span>
              <input type="email" autocapitalize="off" spellcheck="false" [formField]="f.email" />
              <app-erreur [champ]="f.email" />
            </label>
            <label class="champ l3">
              <span>Téléphone</span>
              <input type="tel" [formField]="f.telephone" />
            </label>
            <label class="champ l6">
              <span>Adresse précédente</span>
              <input [formField]="f.adresse_precedente" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Situation professionnelle</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Profession</span>
              <input [formField]="f.profession" />
            </label>
            <label class="champ l2">
              <span>Employeur</span>
              <input [formField]="f.employeur" />
            </label>
            <label class="champ l2">
              <span>Revenus mensuels nets</span>
              <div class="saisie" data-suffixe="€">
                <input type="text" inputmode="decimal" [formField]="f.revenus_mensuels" />
              </div>
              <app-erreur [champ]="f.revenus_mensuels" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Notes</legend>
          <div class="grille-champs">
            <label class="champ l6">
              <span>Notes</span>
              <textarea rows="3" [formField]="f.notes"></textarea>
            </label>
          </div>
        </fieldset>

        <div class="actions-formulaire">
          <button type="button" class="btn" (click)="retour()">Annuler</button>
          <button type="submit" class="btn primaire" [disabled]="f().submitting()">Enregistrer</button>
        </div>
      </form>
    } @else if (locataire.error()) {
      <p class="alerte">Locataire introuvable.</p>
    }
  `,
})
export class LocataireForm {
  readonly id = input(null, { transform: idRoute });
  /** URL de retour après création (ex. depuis le formulaire de bail). */
  readonly retourVers = input<string | null>(null);

  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected readonly options = OPTIONS;

  /** Locataire modifié ; sans id (création), la resource reste inactive et le loader n'est pas appelé. */
  protected readonly locataire = resource({
    params: () => this.id() ?? undefined,
    loader: ({ params: id }) => this.bdd.depot.locataires.exiger(id),
  });
  /** Formulaire affiché en création, ou une fois le locataire chargé. */
  protected readonly pret = computed(() => !this.id() || this.locataire.hasValue());
  protected readonly modele = linkedSignal<ModeleLocataire>(() =>
    textes(CLES, this.locataire.hasValue() ? this.locataire.value() : DEFAUTS),
  );
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  protected enregistrer(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        const v = SCHEMA.parse(this.modele());
        const repo = this.bdd.depot.locataires;
        let id = this.id();
        if (id) await repo.modifier(id, v);
        else id = await repo.creer(v);
        this.notifications.succes('Locataire enregistré');
        const retour = this.retourVers();
        if (retour) {
          // Le formulaire d'origine sélectionne le locataire créé.
          const url = this.router.parseUrl(retour);
          url.queryParams = { ...url.queryParams, locataire: String(id) };
          await this.router.navigateByUrl(url);
        } else {
          await this.router.navigate(['/locataires', id]);
        }
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }

  protected retour() {
    const id = this.id();
    const retour = this.retourVers();
    if (retour) this.router.navigateByUrl(retour);
    else this.router.navigate(id ? ['/locataires', id] : ['/locataires']);
  }
}
