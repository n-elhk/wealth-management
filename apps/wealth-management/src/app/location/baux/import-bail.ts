import { Component, DestroyRef, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { open } from '@tauri-apps/plugin-dialog';
import { LocataireSaisieSchema, nomComplet, type RoleLocataire } from '@wealth-management/core';
import {
  EXTRACTION_BAIL,
  analyserReponseBail,
  rapprocherBien,
  rapprocherLocataire,
  type ExtractionBail,
  type LocataireExtrait,
} from '@wealth-management/core/import';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Brouillons } from '../../infrastructure/brouillons.service';
import { IaLocale, type EtapeAnalyse } from '../../infrastructure/ia-locale.service';
import { Fiche } from '../../ui/fiche/fiche.component';
import { Icone } from '../../ui/icone';
import { Notifications } from '../../ui/notifications.service';
import { cleBrouillonBail, modeleNouveauBail, type BrouillonBail } from './bail.brouillon';
import { champsBail } from './bail.champs';

interface ResultatImport {
  fichier: string;
  donnees: ExtractionBail;
  champsIgnores: string[];
  /** Le document dépassait le contexte du modèle : seuls les passages utiles ont été analysés. */
  reduit: boolean;
}

/** Choix de l'utilisateur avant pré-remplissage : bien loué et, pour chaque locataire lu, création ou association. */
interface ChoixImport {
  bien_id: string;
  /** `'nouveau'`, `'ignorer'` ou l'id d'un locataire existant. */
  locataires: { cible: string }[];
}

/**
 * Import d'un contrat de location PDF : texte extrait par xberg, données lues par le modèle local
 * (Mistral 7B via Candle) et validées par zod, puis formulaire de bail pré-rempli pour relecture.
 * Rien n'est enregistré sans passer par le formulaire, hormis les nouveaux locataires confirmés ici.
 */
@Component({
  selector: 'app-import-bail',
  imports: [FormField, RouterLink, Fiche, Icone],
  styleUrl: './import-bail.css',
  template: `
    <header class="entete">
      <div>
        <a class="retour" routerLink="/baux">← Retour</a>
        <h1>Importer un bail</h1>
      </div>
    </header>

    @if (etat.hasValue()) {
      @let e = etat.value();
      @if (e === null) {
        <p class="alerte">L’import de documents par IA locale n’est disponible que sur ordinateur.</p>
      } @else if (!e.installe) {
        <p class="alerte">
          Le modèle d’IA locale n’est pas installé : téléchargez-le dans les <a routerLink="/parametres">paramètres</a>.
        </p>
      } @else {
        <section class="carte">
          <h2>Contrat de location</h2>
          <p class="muted">
            Choisissez un contrat au format PDF contenant du texte (les documents scannés ne sont pas lus).
            L’analyse prend de une à quelques minutes ; vous relirez ensuite le bail avant de l’enregistrer.
          </p>
          <!-- Zone live toujours présente : seul son contenu change, ce qui garantit l'annonce (VoiceOver / WebKit). -->
          <p role="status" class="etape">{{ progression()?.etape ?? '' }}</p>
          @if (progression(); as p) {
            <div class="progression">
              @if (p.max) {
                <progress [value]="p.valeur ?? 0" [max]="p.max" [attr.aria-label]="p.etape"></progress>
              } @else {
                <progress [attr.aria-label]="p.etape"></progress>
              }
              <p class="muted">{{ p.detail }}</p>
              <button type="button" class="btn" (click)="annuler()">Annuler</button>
            </div>
          } @else {
            <div class="actions">
              <button type="button" class="btn primaire" (click)="analyser()"><app-icone nom="bail" /> Choisir un PDF…</button>
              @if (e.charge) {
                <button type="button" class="btn" (click)="decharger()">Libérer la mémoire du modèle</button>
              }
            </div>
          }
        </section>

        @if (resultat(); as r) {
          @if (r.reduit) {
            <p class="alerte">Document long : seuls le début et les passages utiles (loyer, dates, parties…) ont été analysés.</p>
          }
          @if (r.champsIgnores.length) {
            <p class="alerte">Valeurs illisibles ignorées, à compléter dans le formulaire : {{ r.champsIgnores.join(', ') }}.</p>
          }

          <form (submit)="preremplir($event)" novalidate autocomplete="off">
            <fieldset class="carte">
              <legend>Bien loué</legend>
              @if (adresseLue(); as adresse) {
                <p class="muted">Adresse lue : {{ adresse }}</p>
              }
              <div class="grille-champs">
                <label class="champ l6">
                  <span>Bien</span>
                  <select [formField]="f.bien_id">
                    <option value="">— À choisir dans le formulaire —</option>
                    @for (b of biens(); track b.id) {
                      <option [value]="b.id">{{ b.libelle }}</option>
                    }
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset class="carte">
              <legend>Locataires</legend>
              @if (r.donnees.locataires.length === 0) {
                <p class="muted">Aucun locataire trouvé dans le document : vous les sélectionnerez dans le formulaire.</p>
              }
              <div class="grille-champs">
                @for (lf of f.locataires; track $index; let i = $index) {
                  @let l = r.donnees.locataires[i]!;
                  <label class="champ l3">
                    <span>{{ nom(l) }}</span>
                    <select [formField]="lf.cible">
                      <option value="nouveau" [disabled]="!l.prenom">Créer ce locataire{{ l.prenom ? '' : ' (prénom manquant)' }}</option>
                      <option value="ignorer">Ne pas l’ajouter</option>
                      @for (x of locatairesExistants(); track x.id) {
                        <option [value]="x.id">Associer à {{ nom(x) }}</option>
                      }
                    </select>
                  </label>
                }
              </div>
            </fieldset>

            <app-fiche [champs]="champs" [valeur]="apercu()" />

            <div class="actions-formulaire">
              <button type="button" class="btn" (click)="resultat.set(null)">Abandonner</button>
              <button type="submit" class="btn primaire" [disabled]="enCours()">Pré-remplir le bail</button>
            </div>
          </form>
        }
      }
    }
  `,
})
export class ImportBail {
  private readonly ia = inject(IaLocale);
  private readonly bdd = inject(BaseDeDonnees);
  private readonly brouillons = inject(Brouillons);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected readonly etat = this.ia.etat;
  protected readonly listes = resource({
    loader: async () => {
      const depot = this.bdd.depot;
      const [biens, locataires] = await Promise.all([depot.biens.listerResumes(), depot.locataires.lister()]);
      return { biens, locataires };
    },
  });
  protected readonly biens = computed(() => (this.listes.hasValue() ? this.listes.value().biens : []));
  protected readonly locatairesExistants = computed(() => (this.listes.hasValue() ? this.listes.value().locataires : []));

  protected readonly progression = signal<EtapeAnalyse | null>(null);
  /** Analyse en cours, interrompue par « Annuler » ou en quittant la page. */
  private analyse: AbortController | null = null;
  protected readonly resultat = signal<ResultatImport | null>(null);
  protected readonly enCours = signal(false);

  /** Choix initialisés par rapprochement avec les biens et locataires existants. */
  protected readonly choix = linkedSignal<ChoixImport>(() => {
    const r = this.resultat();
    if (!r) return { bien_id: '', locataires: [] };
    const bien = rapprocherBien(r.donnees.bien, this.biens());
    return {
      bien_id: bien ? String(bien.id) : '',
      locataires: r.donnees.locataires.map((l) => {
        const existant = rapprocherLocataire(l, this.locatairesExistants());
        return { cible: existant ? String(existant.id) : l.prenom ? 'nouveau' : 'ignorer' };
      }),
    };
  });
  protected readonly f = form(this.choix);

  protected readonly adresseLue = computed(() => {
    const b = this.resultat()?.donnees.bien;
    return b ? [b.adresse_ligne1, b.code_postal, b.ville].filter(Boolean).join(' ') : '';
  });

  protected readonly champs = champsBail([]);
  /** Données lues, affichées avec la fiche de bail (les cases attendent 0 / 1). */
  protected readonly apercu = computed(() => {
    const r = this.resultat();
    if (!r) return {};
    const { bien: _bien, locataires: _locataires, ...bail } = r.donnees;
    return { ...bail, tacite_reconduction: bail.tacite_reconduction ? 1 : 0, zone_tendue: bail.zone_tendue ? 1 : 0 };
  });

  constructor() {
    // Quitter la page interrompt l'opération en cours (le modèle reste chargé jusqu'à « Libérer la mémoire »).
    inject(DestroyRef).onDestroy(() => this.analyse?.abort());
  }

  protected nom(l: Pick<LocataireExtrait, 'civilite' | 'nom' | 'prenom'>) {
    return nomComplet(l, true);
  }

  protected annuler() {
    this.analyse?.abort();
  }

  protected async decharger() {
    try {
      await this.ia.decharger();
    } catch (e) {
      this.notifications.erreur(e);
    }
  }

  protected async analyser() {
    const analyse = new AbortController();
    this.analyse = analyse;
    const chemin = await open({ multiple: false, directory: false, filters: [{ name: 'Contrat PDF', extensions: ['pdf'] }] });
    // Page quittée pendant le choix du fichier : rien à faire.
    if (!chemin || analyse.signal.aborted) return;
    const fichier = chemin.split(/[\\/]/).pop() ?? chemin;

    this.resultat.set(null);
    try {
      const { sortie, reduit } = await this.ia.analyserDocument(
        chemin,
        EXTRACTION_BAIL,
        (e) => this.progression.set(e),
        analyse.signal,
      );
      const { donnees, champsIgnores } = analyserReponseBail(sortie);
      this.resultat.set({ fichier, donnees, champsIgnores, reduit });
    } catch (e) {
      // Annulation (bouton ou page quittée) : pas d'erreur à afficher, sur cette page ou une autre.
      if (!analyse.signal.aborted) this.notifications.erreur(e);
    } finally {
      this.progression.set(null);
      if (this.analyse === analyse) this.analyse = null;
    }
  }

  /** Crée les locataires confirmés puis ouvre le formulaire de bail pré-rempli. */
  protected async preremplir(event: Event) {
    event.preventDefault();
    const r = this.resultat();
    if (!r || this.enCours()) return;
    this.enCours.set(true);
    try {
      const choix = this.choix();
      const depot = this.bdd.depot;
      const roles: [number, RoleLocataire][] = [];
      for (const [i, l] of r.donnees.locataires.entries()) {
        const cible = choix.locataires[i]?.cible ?? 'ignorer';
        if (cible === 'ignorer') continue;
        const id = cible === 'nouveau' ? await depot.locataires.creer(saisieLocataire(l, r.fichier)) : Number(cible);
        if (!roles.some(([x]) => x === id)) roles.push([id, roles.length === 0 ? 'titulaire' : 'colocataire']);
      }

      const { bien: _bien, locataires: _locataires, tacite_reconduction, zone_tendue, ...bail } = r.donnees;
      const modele = modeleNouveauBail({
        ...bail,
        bien_id: Number(choix.bien_id) || null,
        tacite_reconduction: tacite_reconduction === null ? null : tacite_reconduction ? 1 : 0,
        zone_tendue: zone_tendue === null ? null : zone_tendue ? 1 : 0,
        notes: `Importé depuis « ${r.fichier} » : vérifiez les données avant d’enregistrer.`,
      });
      this.brouillons.conserver<BrouillonBail>(cleBrouillonBail(null), { modele, roles });
      await this.router.navigate(['/baux/nouveau']);
    } catch (e) {
      this.notifications.erreur(e);
    } finally {
      this.enCours.set(false);
    }
  }
}

/** Saisie d'un nouveau locataire : les valeurs lues mais refusées par le schéma (e-mail mal formé…) sont écartées. */
function saisieLocataire(l: LocataireExtrait, fichier: string) {
  const saisie: Record<string, unknown> = { ...l, notes: `Importé depuis « ${fichier} ».` };
  const r = LocataireSaisieSchema.safeParse(saisie);
  if (r.success) return r.data;
  for (const issue of r.error.issues) {
    const cle = issue.path[0];
    if (typeof cle === 'string' && cle !== 'nom' && cle !== 'prenom') saisie[cle] = null;
  }
  return LocataireSaisieSchema.parse(saisie);
}
