import { Component, computed, debounced, inject, input, linkedSignal, resource, signal } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { OPTIONS, type SocieteRegistre, SocieteSaisieSchema, normaliserSiren } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { RegistreEntreprises } from '../../infrastructure/registre-entreprises.service';
import { Notifications } from '../../ui/notifications.service';
import { idRoute } from '../../ui/route';
import { AccessibiliteChamp, ErreurChamp, nombre, sansVides, schemaModele, texte, textes } from '../../ui/formulaire/saisie';

const CLES = [
  'raison_sociale', 'forme_juridique', 'siren', 'rcs_ville', 'date_creation', 'objet_social',
  'capital', 'nombre_parts', 'valeur_nominale_part', 'regime_fiscal', 'date_cloture_exercice',
  'representant_nom', 'representant_qualite', 'email', 'telephone', 'iban',
  'adresse_ligne1', 'adresse_ligne2', 'code_postal', 'ville', 'pays', 'notes',
] as const;
type ModeleSociete = Record<(typeof CLES)[number], string>;

const DEFAUTS = { forme_juridique: 'SCI', regime_fiscal: 'IR', pays: 'France', representant_qualite: 'Gérant' };

/** Champs renvoyés par l'Annuaire des entreprises, en texte de saisie (le SIREN tapé est conservé tel quel). */
function champsRegistre({ siren: _, ...champs }: SocieteRegistre): Partial<ModeleSociete> {
  return Object.fromEntries(Object.entries(champs).map(([cle, v]) => [cle, texte(v)]));
}

const SCHEMA = schemaModele(
  (m: ModeleSociete) => ({
    ...sansVides(m),
    capital: nombre(m.capital),
    nombre_parts: nombre(m.nombre_parts),
    valeur_nominale_part: nombre(m.valeur_nominale_part),
  }),
  SocieteSaisieSchema,
);

@Component({
  selector: 'app-societe-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp, RouterLink],
  template: `
    <header class="entete">
      <div>
        <a class="retour" [routerLink]="id() ? ['/societes', id()] : '/societes'">← Retour</a>
        <h1>{{ id() ? 'Modifier la société' : 'Nouvelle société' }}</h1>
      </div>
    </header>

    @if (pret()) {
      <form (submit)="enregistrer($event)" novalidate autocomplete="off">
        <fieldset class="carte">
          <legend>Identification</legend>
          <div class="grille-champs">
            <label class="champ l4">
              <span>Raison sociale<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.raison_sociale" />
              <app-erreur [champ]="f.raison_sociale" />
            </label>
            <label class="champ l2">
              <span>Forme juridique<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.forme_juridique">
                @for (o of options.formeJuridique; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
              <app-erreur [champ]="f.forme_juridique" />
            </label>
            <!-- div + label[for] : le bouton « Pré-remplir » ne peut pas être dans le <label> du champ. -->
            <div class="champ l2">
              <label for="societe-siren">SIREN</label>
              <input id="societe-siren" inputmode="numeric" [formField]="f.siren" placeholder="123 456 789" />
              <app-erreur [champ]="f.siren" />
              <small class="aide" role="status">{{ messageRegistre() }}</small>
              @if (ficheAProposer(); as fiche) {
                <button type="button" class="btn petit" (click)="preRemplir(fiche)">Pré-remplir le formulaire</button>
              }
              @if (registreSociete.status() === 'error') {
                <button type="button" class="btn petit" (click)="registreSociete.reload()">Réessayer</button>
              }
            </div>
            <label class="champ l2">
              <span>Greffe (RCS)</span>
              <input [formField]="f.rcs_ville" />
            </label>
            <label class="champ l2">
              <span>Date de création</span>
              <input type="date" [formField]="f.date_creation" />
              <app-erreur [champ]="f.date_creation" />
            </label>
            <label class="champ l6">
              <span>Objet social</span>
              <textarea rows="3" [formField]="f.objet_social"></textarea>
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Capital & fiscalité</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Capital social</span>
              <div class="saisie" data-suffixe="€">
                <input type="text" inputmode="decimal" [formField]="f.capital" />
              </div>
              <app-erreur [champ]="f.capital" />
            </label>
            <label class="champ l2">
              <span>Nombre de parts</span>
              <input type="text" inputmode="numeric" [formField]="f.nombre_parts" />
              <app-erreur [champ]="f.nombre_parts" />
            </label>
            <label class="champ l2">
              <span>Valeur nominale d’une part</span>
              <div class="saisie" data-suffixe="€">
                <input type="text" inputmode="decimal" [formField]="f.valeur_nominale_part" />
              </div>
              <app-erreur [champ]="f.valeur_nominale_part" />
            </label>
            <label class="champ l3">
              <span>Régime fiscal</span>
              <select [formField]="f.regime_fiscal">
                <option value="">—</option>
                @for (o of options.regimeFiscal; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l3">
              <span>Clôture de l’exercice</span>
              <input [formField]="f.date_cloture_exercice" placeholder="31/12" />
              <app-erreur [champ]="f.date_cloture_exercice" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Représentation</legend>
          <div class="grille-champs">
            <label class="champ l3">
              <span>Représentant légal</span>
              <input [formField]="f.representant_nom" />
            </label>
            <label class="champ l3">
              <span>Qualité</span>
              <input [formField]="f.representant_qualite" placeholder="Gérant" />
            </label>
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
              <span>IBAN</span>
              <input [formField]="f.iban" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Siège social</legend>
          <div class="grille-champs">
            <label class="champ l6">
              <span>Adresse</span>
              <input [formField]="f.adresse_ligne1" />
            </label>
            <label class="champ l6">
              <span>Complément d'adresse</span>
              <input [formField]="f.adresse_ligne2" />
            </label>
            <label class="champ l2">
              <span>Code postal</span>
              <input [formField]="f.code_postal" />
            </label>
            <label class="champ l2">
              <span>Ville</span>
              <input [formField]="f.ville" />
            </label>
            <label class="champ l2">
              <span>Pays</span>
              <input [formField]="f.pays" />
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
    }
  `,
})
export class SocieteForm {
  readonly id = input(null, { transform: idRoute });
  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);
  private readonly registre = inject(RegistreEntreprises);

  protected readonly options = OPTIONS;

  /** Société modifiée ; sans id (création), la resource reste inactive et le loader n'est pas appelé. */
  protected readonly societe = resource({
    params: () => this.id() ?? undefined,
    loader: ({ params: id }) => this.bdd.depot.societes.exiger(id),
  });
  /** Formulaire affiché en création, ou une fois la société chargée. */
  protected readonly pret = computed(() => !this.id() || this.societe.hasValue());
  /**
   * Modèle du formulaire : réinitialisé quand la société chargée change, complété (sans perdre la saisie)
   * quand l'Annuaire des entreprises renvoie une fiche pour le SIREN saisi.
   */
  protected readonly modele = linkedSignal<ModeleSociete>(() =>
    textes(CLES, this.societe.hasValue() ? this.societe.value() : DEFAUTS),
  );
  protected readonly f = form(this.modele, (p) => validateStandardSchema(p, SCHEMA.validation));

  /** SIREN saisi (9 chiffres), stabilisé : la recherche ne part qu'une fois la frappe terminée. */
  private readonly sirenSaisi = debounced(() => normaliserSiren(this.modele().siren), 400);
  /** Fiche de l'Annuaire des entreprises ; pas de recherche pour le SIREN déjà enregistré (modification). */
  protected readonly registreSociete = resource({
    params: () => {
      const siren = this.sirenSaisi.hasValue() ? this.sirenSaisi.value() : null;
      const enregistre = this.societe.hasValue() ? normaliserSiren(this.societe.value().siren) : null;
      return siren && siren !== enregistre ? siren : undefined;
    },
    loader: ({ params: siren, abortSignal }) => this.registre.rechercherSiren(siren, abortSignal),
  });
  /** Dernière fiche reportée dans le formulaire (le bouton disparaît une fois utilisée). */
  private readonly ficheAppliquee = signal<SocieteRegistre | null>(null);
  protected readonly ficheAProposer = computed(() => {
    const fiche = this.registreSociete.hasValue() ? this.registreSociete.value() : null;
    return fiche && fiche !== this.ficheAppliquee() ? fiche : null;
  });
  protected readonly messageRegistre = computed(() => {
    const r = this.registreSociete;
    if (r.isLoading()) return 'Recherche dans l’Annuaire des entreprises…';
    if (r.status() === 'error') return 'Annuaire des entreprises injoignable : saisissez les informations manuellement.';
    if (!r.hasValue()) return '';
    const fiche = r.value();
    if (!fiche) return 'Aucune entreprise trouvée pour ce SIREN.';
    if (fiche === this.ficheAppliquee()) return 'Formulaire pré-rempli : vérifiez les informations.';
    return `Trouvée : ${[fiche.raison_sociale, fiche.ville].filter(Boolean).join(' — ')}`;
  });

  /** Reporte la fiche de l'Annuaire dans le formulaire ; les champs qu'elle ne fournit pas sont conservés. */
  protected preRemplir(fiche: SocieteRegistre) {
    this.modele.update((m) => ({ ...m, ...champsRegistre(fiche) }));
    this.ficheAppliquee.set(fiche);
  }

  protected enregistrer(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        const v = SCHEMA.parse(this.modele());
        const repo = this.bdd.depot.societes;
        let id = this.id();
        if (id) await repo.modifier(id, v);
        else id = await repo.creer(v);
        this.notifications.succes('Société enregistrée');
        await this.router.navigate(['/societes', id]);
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }

  protected retour() {
    const id = this.id();
    this.router.navigate(id ? ['/societes', id] : ['/societes']);
  }
}
