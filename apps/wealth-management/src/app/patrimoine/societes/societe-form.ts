import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  debounced,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { confirm } from '@tauri-apps/plugin-dialog';
import { AssocieSaisieSchema, OPTIONS, type SocieteRegistre, SocieteSaisieSchema, nomComplet, normaliserSiren } from '@wealth-management/core';
import { rapprocherSociete, type AssocieExtrait, type ExtractionSociete } from '@wealth-management/core/import';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { RegistreEntreprises } from '../../infrastructure/registre-entreprises.service';
import { Notifications } from '../../ui/notifications.service';
import { idRoute } from '../../ui/route';
import { AccessibiliteChamp, ErreurChamp, nombre, sansVides, schemaModele, texte, textes } from '../../ui/formulaire/saisie';
import { ImportSocieteIa, type ImportSociete } from './import-societe';

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

/** Champs lus par l'IA, en texte de saisie ; les informations absentes du document ne remplacent pas la saisie. */
function champsImportes({ associes: _, ...champs }: ExtractionSociete): Partial<ModeleSociete> {
  return Object.fromEntries(Object.entries(champs).filter(([, v]) => v !== null).map(([cle, v]) => [cle, texte(v)]));
}

/** Mention ajoutée aux notes ; remplacée (et non cumulée) lors d'un nouvel import. */
const noteImport = (fichier: string) => `Importé depuis « ${fichier} » : vérifiez les données.`;

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
  imports: [FormField, AccessibiliteChamp, ErreurChamp, RouterLink, ImportSocieteIa],
  template: `
    <header class="entete">
      <div>
        <a class="retour" [routerLink]="id() ? ['/societes', id()] : '/societes'">← Retour</a>
        <h1>{{ id() ? 'Modifier la société' : 'Nouvelle société' }}</h1>
      </div>
    </header>

    @if (pret()) {
      @if (!id()) {
        <app-import-societe (importe)="appliquerImport($event)" />
      }
      <!-- Zone live toujours présente : seul son contenu change, ce qui garantit l'annonce (VoiceOver / WebKit). -->
      <div role="status">
        @if (importSociete(); as imp) {
          <p class="alerte">Formulaire pré-rempli depuis « {{ imp.fichier }} » : vérifiez les informations avant d’enregistrer.</p>
          @if (imp.reduit) {
            <p class="alerte">Document long : seuls le début et les passages utiles (capital, siège, associés…) ont été analysés.</p>
          }
          @if (imp.champsIgnores.length) {
            <p class="alerte">Valeurs illisibles ignorées, à compléter : {{ imp.champsIgnores.join(', ') }}.</p>
          }
          @if (societeExistante(); as existante) {
            <p class="alerte">
              Cette société semble déjà enregistrée :
              <a [routerLink]="['/societes', existante.id]">{{ existante.raison_sociale }}</a>.
              Une confirmation vous sera demandée avant d’en créer une seconde.
            </p>
          }
        }
      </div>
      <form (submit)="enregistrer($event)" novalidate autocomplete="off">
        <fieldset class="carte">
          <legend>Identification</legend>
          <div class="grille-champs">
            <label class="champ l4">
              <span>Raison sociale<b class="requis">*</b></span>
              <input #champRaisonSociale aria-required="true" [formField]="f.raison_sociale" />
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

        @if (associesLus().length) {
          <fieldset class="carte">
            <legend>Associés lus dans le document</legend>
            <p class="muted">
              Les associés cochés seront ajoutés à l’enregistrement de la société. Leur nom et leur nombre de parts
              ne se modifient pas ici : corrigez-les ensuite sur la fiche de la société.
            </p>
            @if (ecartParts(); as ecart) {
              <p class="alerte">
                Les associés détiennent {{ ecart.associes }} part(s) au total, pour {{ ecart.total }} part(s) dans la société :
                le document a peut-être été mal lu, vérifiez la répartition.
              </p>
            }
            <div class="grille-champs">
              @for (cf of fa; track $index; let i = $index) {
                @let a = associesLus()[i]!;
                <label class="champ case l3">
                  <input type="checkbox" [formField]="cf.ajouter" />
                  <span>{{ libelleAssocie(a) }}</span>
                </label>
              }
            </div>
          </fieldset>
        }

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

  private readonly injector = inject(Injector);
  private readonly champRaisonSociale = viewChild<ElementRef<HTMLInputElement>>('champRaisonSociale');

  /** Dernier import par l'IA locale (création uniquement). */
  protected readonly importSociete = signal<ImportSociete | null>(null);
  protected readonly associesLus = computed(() => this.importSociete()?.donnees.associes ?? []);
  /** Associés lus à créer avec la société : cochés par défaut, sauf ceux dont le nombre de parts est inconnu. */
  private readonly choixAssocies = linkedSignal(() => this.associesLus().map((a) => ({ ajouter: a.nombre_parts !== null })));
  /**
   * Somme des parts des associés lus différente du nombre total de parts du formulaire : signe probable
   * d'une lecture ratée. `null` si les deux concordent ou si une donnée manque.
   */
  protected readonly ecartParts = computed(() => {
    const associes = this.associesLus();
    const total = nombre(this.modele().nombre_parts);
    if (!associes.length || total === null || associes.some((a) => a.nombre_parts === null)) return null;
    const somme = associes.reduce((n, a) => n + (a.nombre_parts ?? 0), 0);
    return somme === total ? null : { associes: somme, total };
  });
  protected readonly fa = form(this.choixAssocies);
  /** Société déjà enregistrée avec le même SIREN ou la même raison sociale que le document importé. */
  private readonly existantes = resource({
    params: () => this.importSociete() ?? undefined,
    loader: ({ params: imp }) => this.bdd.depot.societes.lister().then((l) => rapprocherSociete(imp.donnees, l)),
  });
  protected readonly societeExistante = computed(() => (this.existantes.hasValue() ? this.existantes.value() : null));

  /** Reporte les données lues par l'IA dans le formulaire ; les champs absents du document sont conservés. */
  protected appliquerImport(imp: ImportSociete) {
    const precedent = this.importSociete();
    this.modele.update((m) => ({
      ...m,
      ...champsImportes(imp.donnees),
      // Mention du fichier remplacée lors d'un nouvel import ; une note saisie par l'utilisateur est conservée.
      notes: !m.notes || (precedent && m.notes === noteImport(precedent.fichier)) ? noteImport(imp.fichier) : m.notes,
    }));
    this.importSociete.set(imp);
    // Le bloc de progression (et son bouton « Annuler », qui avait le focus) a disparu : le focus va au
    // premier champ pré-rempli ; le résumé de l'import est annoncé par la zone live.
    afterNextRender(() => this.champRaisonSociale()?.nativeElement.focus(), { injector: this.injector });
  }

  protected libelleAssocie(a: AssocieExtrait) {
    const parts = a.nombre_parts === null ? 'nombre de parts inconnu (0 sera enregistré)' : `${a.nombre_parts} part(s)`;
    const details = [parts, a.est_gerant ? 'gérant' : null];
    const suffixe = details.filter(Boolean).join(', ');
    return suffixe ? `${nomComplet(a, true)} — ${suffixe}` : nomComplet(a, true);
  }

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
        const existante = id ? null : this.societeExistante();
        if (
          existante &&
          !(await confirm(`« ${existante.raison_sociale} » est déjà enregistrée. Créer quand même une seconde société ?`, {
            title: 'Société déjà enregistrée',
            kind: 'warning',
            okLabel: 'Créer quand même',
            cancelLabel: 'Annuler',
          }))
        ) {
          return;
        }
        let associesEnEchec: string[] = [];
        if (id) await repo.modifier(id, v);
        else {
          id = await repo.creer(v);
          // La société existe désormais : quoi qu'il arrive aux associés, on quitte le formulaire de
          // création (un nouvel « Enregistrer » créerait la société en double).
          associesEnEchec = await this.creerAssociesImportes(id);
        }
        this.notifications.succes('Société enregistrée');
        if (associesEnEchec.length) {
          this.notifications.erreur(
            `Associés non ajoutés (à saisir sur la fiche) : ${associesEnEchec.join(' ; ')}`,
          );
        }
        await this.router.navigate(['/societes', id]);
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }

  /**
   * Crée les associés lus par l'IA et cochés ; le nombre de parts manquant vaut 0 (à corriger sur la fiche).
   * Ne lève jamais : renvoie le libellé de chaque associé non créé, avec la cause.
   */
  private async creerAssociesImportes(societeId: number): Promise<string[]> {
    const imp = this.importSociete();
    if (!imp) return [];
    const choix = this.choixAssocies();
    const echecs: string[] = [];
    for (const [i, a] of this.associesLus().entries()) {
      if (!choix[i]?.ajouter) continue;
      try {
        await this.bdd.depot.societes.associes.creer(
          AssocieSaisieSchema.parse({
            societe_id: societeId,
            civilite: a.civilite,
            nom: a.nom,
            prenom: a.prenom,
            nombre_parts: a.nombre_parts ?? 0,
            est_gerant: a.est_gerant ?? false,
            notes: `Importé depuis « ${imp.fichier} ».`,
          }),
        );
      } catch (e) {
        echecs.push(`${nomComplet(a, true)} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return echecs;
  }

  protected retour() {
    const id = this.id();
    this.router.navigate(id ? ['/societes', id] : ['/societes']);
  }
}
