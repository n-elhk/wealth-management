import { Component, inject, linkedSignal, resource, signal } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { OPTIONS, ProfilBailleurSaisieSchema, aujourdhui, type ProfilBailleur } from '@wealth-management/core';
import { BaseDeDonnees, FICHIER_BDD } from '../infrastructure/base-de-donnees.service';
import { Documents } from '../infrastructure/documents.service';
import { Notifications } from '../ui/notifications.service';
import { AccessibiliteChamp, ErreurChamp, sansVides, schemaModele, textes } from '../ui/formulaire/saisie';

const CLES = [
  'civilite', 'prenom', 'nom', 'date_naissance', 'lieu_naissance', 'email', 'telephone', 'iban',
  'adresse_ligne1', 'adresse_ligne2', 'code_postal', 'ville', 'pays',
] as const;
type ModeleProfil = Record<(typeof CLES)[number], string>;

const versModele = (p: ProfilBailleur | null | undefined): ModeleProfil => textes(CLES, p ?? { pays: 'France' });
const SCHEMA = schemaModele((m: ModeleProfil) => sansVides(m), ProfilBailleurSaisieSchema);

@Component({
  selector: 'app-parametres',
  imports: [FormField, AccessibiliteChamp, ErreurChamp],
  template: `
    <header class="entete">
      <h1>Paramètres</h1>
    </header>

    <h2 class="sous-titre">Mon identité de bailleur (biens en nom propre)</h2>
    <p class="muted">Ces informations apparaissent sur les contrats et quittances des biens que vous détenez personnellement.
      Pour les biens détenus via une société, ce sont les informations de la société qui sont utilisées.</p>

    @if (profil.hasValue()) {
      <form (submit)="enregistrer($event)" novalidate>
        <fieldset class="carte">
          <legend>Identité</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Civilité</span>
              <select autocomplete="honorific-prefix" [formField]="f.civilite">
                <option value="">—</option>
                @for (o of options.civilite; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Prénom<b class="requis">*</b></span>
              <input aria-required="true" autocomplete="given-name" [formField]="f.prenom" />
              <app-erreur [champ]="f.prenom" />
            </label>
            <label class="champ l2">
              <span>Nom<b class="requis">*</b></span>
              <input aria-required="true" autocomplete="family-name" [formField]="f.nom" />
              <app-erreur [champ]="f.nom" />
            </label>
            <label class="champ l3">
              <span>Date de naissance</span>
              <input type="date" autocomplete="bday" [formField]="f.date_naissance" />
              <app-erreur [champ]="f.date_naissance" />
            </label>
            <label class="champ l3">
              <span>Lieu de naissance</span>
              <input autocomplete="off" [formField]="f.lieu_naissance" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Contact</legend>
          <div class="grille-champs">
            <label class="champ l3">
              <span>E-mail</span>
              <input type="email" autocapitalize="off" spellcheck="false" autocomplete="email" [formField]="f.email" />
              <app-erreur [champ]="f.email" />
            </label>
            <label class="champ l3">
              <span>Téléphone</span>
              <input type="tel" autocomplete="tel" [formField]="f.telephone" />
            </label>
            <label class="champ l6">
              <span>IBAN (pour les avis d’échéance)</span>
              <input autocomplete="off" [formField]="f.iban" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Adresse</legend>
          <div class="grille-champs">
            <label class="champ l6">
              <span>Adresse</span>
              <input autocomplete="address-line1" [formField]="f.adresse_ligne1" />
            </label>
            <label class="champ l6">
              <span>Complément d'adresse</span>
              <input autocomplete="address-line2" [formField]="f.adresse_ligne2" />
            </label>
            <label class="champ l2">
              <span>Code postal</span>
              <input autocomplete="postal-code" inputmode="numeric" [formField]="f.code_postal" />
            </label>
            <label class="champ l2">
              <span>Ville</span>
              <input autocomplete="address-level2" [formField]="f.ville" />
            </label>
            <label class="champ l2">
              <span>Pays</span>
              <input autocomplete="country-name" [formField]="f.pays" />
            </label>
          </div>
        </fieldset>

        <div class="actions-formulaire">
          <button type="button" class="btn" (click)="profil.reload()">Annuler</button>
          <button type="submit" class="btn primaire" [disabled]="f().submitting()">Enregistrer</button>
        </div>
      </form>
    }

    <section class="carte">
      <h2>Données</h2>
      <p class="muted">Les données sont stockées localement dans la base SQLite <code>{{ fichier }}</code>, dans le dossier de données de l’application.</p>
      <button class="btn" (click)="exporter()">Exporter une sauvegarde (JSON)</button>
    </section>
  `,
})
export class Parametres {
  private readonly bdd = inject(BaseDeDonnees);
  private readonly documents = inject(Documents);
  private readonly notifications = inject(Notifications);

  protected readonly options = OPTIONS;
  protected readonly fichier = FICHIER_BDD.replace('sqlite:', '');

  protected readonly profil = resource({ loader: () => this.bdd.depot.profil.obtenir() });
  /** Modèle du formulaire, réinitialisé à chaque (re)chargement du profil. */
  protected readonly modele = linkedSignal(() => versModele(this.profil.value()));
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  protected enregistrer(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        await this.bdd.depot.profil.enregistrer(SCHEMA.parse(this.modele()));
        this.notifications.succes('Profil enregistré');
        this.profil.reload();
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }

  protected async exporter() {
    try {
      await this.documents.json(await this.bdd.exporter(), `wealth-management-sauvegarde-${aujourdhui()}`);
    } catch (e) {
      this.notifications.erreur(e);
    }
  }
}
