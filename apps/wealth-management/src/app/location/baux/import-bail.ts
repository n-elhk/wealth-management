import { Component, DestroyRef, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { open } from '@tauri-apps/plugin-dialog';
import { LocataireSaisieSchema, nomComplet, type RoleLocataire } from '@wealth-management/core';
import {
  MAX_TOKENS_REPONSE_BAIL,
  analyserReponseBail,
  promptExtractionBail,
  rapprocherBien,
  rapprocherLocataire,
  selectionnerPassages,
  type ExtractionBail,
  type LocataireExtrait,
} from '@wealth-management/core/import';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Brouillons } from '../../infrastructure/brouillons.service';
import { IaLocale, type ProgressionGeneration } from '../../infrastructure/ia-locale.service';
import { Fiche } from '../../ui/fiche/fiche.component';
import { Icone } from '../../ui/icone';
import { Notifications } from '../../ui/notifications.service';
import { cleBrouillonBail, modeleNouveauBail, type BrouillonBail } from './bail.brouillon';
import { champsBail } from './bail.champs';

interface Progression {
  /** Étape en cours, annoncée aux lecteurs d'écran (change rarement). */
  etape: string;
  valeur?: number;
  max?: number;
  detail?: string;
}

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

const GO = 1024 ** 3;

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
        <section class="carte">
          <h2>Modèle d’IA locale</h2>
          <p>
            L’analyse utilise Mistral 7B Instruct, exécuté sur cet ordinateur : aucun document n’est envoyé sur Internet.
            Le modèle ({{ taille(e.tailleTotale) }}) est téléchargé une seule fois depuis Hugging Face,
            puis vérifié ; 16 Go de mémoire vive sont conseillés.
          </p>
          @if (progression(); as p) {
            <div class="progression">
              <p role="status">{{ p.etape }}</p>
              <progress [value]="p.valeur ?? 0" [max]="p.max ?? 1" [attr.aria-label]="p.etape"></progress>
              <p class="muted">{{ p.detail }}</p>
              <button type="button" class="btn" (click)="annuler()">Interrompre</button>
            </div>
          } @else {
            <button type="button" class="btn primaire" (click)="telecharger()">Télécharger le modèle</button>
          }
        </section>
      } @else {
        <section class="carte">
          <h2>Contrat de location</h2>
          <p class="muted">
            Choisissez un contrat au format PDF contenant du texte (les documents scannés ne sont pas lus).
            L’analyse prend de une à quelques minutes ; vous relirez ensuite le bail avant de l’enregistrer.
          </p>
          @if (progression(); as p) {
            <div class="progression">
              <p role="status">{{ p.etape }}</p>
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

  protected readonly etat = resource({ loader: () => this.ia.etat() });
  protected readonly listes = resource({
    loader: async () => {
      const depot = this.bdd.depot;
      const [biens, locataires] = await Promise.all([depot.biens.listerResumes(), depot.locataires.lister()]);
      return { biens, locataires };
    },
  });
  protected readonly biens = computed(() => (this.listes.hasValue() ? this.listes.value().biens : []));
  protected readonly locatairesExistants = computed(() => (this.listes.hasValue() ? this.listes.value().locataires : []));

  protected readonly progression = signal<Progression | null>(null);
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
    inject(DestroyRef).onDestroy(() => {
      if (this.progression()) void this.ia.annuler();
    });
  }

  protected taille(octets: number) {
    return `${(octets / GO).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
  }

  protected nom(l: Pick<LocataireExtrait, 'civilite' | 'nom' | 'prenom'>) {
    return nomComplet(l, true);
  }

  protected async telecharger() {
    this.progression.set({ etape: 'Téléchargement du modèle…' });
    try {
      await this.ia.telecharger((p) =>
        this.progression.set({
          etape: 'Téléchargement du modèle…',
          valeur: p.recu,
          max: p.total,
          detail: `${p.fichier} : ${this.taille(p.recu)} sur ${this.taille(p.total)}`,
        }),
      );
      this.notifications.succes('Modèle installé');
    } catch (e) {
      this.notifications.erreur(e);
    } finally {
      this.progression.set(null);
      this.etat.reload();
    }
  }

  protected annuler() {
    void this.ia.annuler();
  }

  protected async decharger() {
    await this.ia.decharger();
    this.etat.reload();
  }

  protected async analyser() {
    const etat = this.etat.value();
    if (!etat) return;
    const chemin = await open({ multiple: false, directory: false, filters: [{ name: 'Contrat PDF', extensions: ['pdf'] }] });
    if (!chemin) return;
    const fichier = chemin.split(/[\\/]/).pop() ?? chemin;

    this.resultat.set(null);
    this.progression.set({ etape: 'Lecture du document…' });
    try {
      const texte = await this.ia.extraireTexte(chemin);
      this.progression.set({ etape: 'Préparation de l’analyse…' });
      const { document, reduit } = await this.ajusterAuContexte(texte, etat.contexte);
      const sortie = await this.ia.generer(promptExtractionBail(document), MAX_TOKENS_REPONSE_BAIL, (p) =>
        this.progression.set(progressionGeneration(p)),
      );
      const { donnees, champsIgnores } = analyserReponseBail(sortie);
      this.resultat.set({ fichier, donnees, champsIgnores, reduit });
    } catch (e) {
      this.notifications.erreur(e);
    } finally {
      this.progression.set(null);
      this.etat.reload();
    }
  }

  /**
   * Réduit le document pour que prompt + réponse tiennent dans le contexte du modèle (4 096 tokens) :
   * estimation à ~3 caractères par token, puis ajustement sur le compte exact du tokenizer.
   */
  private async ajusterAuContexte(texte: string, contexte: number): Promise<{ document: string; reduit: boolean }> {
    const disponible = contexte - MAX_TOKENS_REPONSE_BAIL;
    const base = await this.ia.compterTokens(promptExtractionBail(''));
    let caracteres = Math.max(500, (disponible - base) * 3);
    for (let essai = 0; essai < 5; essai++) {
      const document = selectionnerPassages(texte, caracteres);
      const tokens = await this.ia.compterTokens(promptExtractionBail(document));
      if (tokens <= disponible) return { document, reduit: document.length < texte.trim().length * 0.95 };
      caracteres = Math.floor(caracteres * ((disponible - base) / (tokens - base)) * 0.95);
    }
    throw new Error('Impossible de réduire ce document à la taille acceptée par le modèle.');
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

function progressionGeneration(p: ProgressionGeneration): Progression {
  switch (p.etape) {
    case 'chargement':
      return { etape: 'Chargement du modèle en mémoire…', detail: 'Une quinzaine de secondes au premier lancement.' };
    case 'prompt':
      return { etape: 'Lecture du contrat par le modèle…', valeur: p.traite, max: p.total, detail: `${p.traite} / ${p.total} tokens` };
    case 'generation':
      return { etape: 'Extraction des informations…', valeur: p.tokens, max: p.max, detail: `${p.tokens} tokens générés` };
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
