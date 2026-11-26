import { Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { open } from '@tauri-apps/plugin-dialog';
import { EXTRACTION_SOCIETE, analyserReponseSociete, type ExtractionSociete } from '@wealth-management/core/import';
import { IaLocale, type EtapeAnalyse } from '../../infrastructure/ia-locale.service';
import { Icone } from '../../ui/icone';
import { Notifications } from '../../ui/notifications.service';

/** Données lues dans les statuts ou le Kbis, à reporter dans le formulaire de société. */
export interface ImportSociete {
  fichier: string;
  donnees: ExtractionSociete;
  champsIgnores: string[];
  /** Le document dépassait le contexte du modèle : seuls les passages utiles ont été analysés. */
  reduit: boolean;
}

/**
 * Lecture de statuts ou d'un Kbis par le modèle d'IA locale (desktop uniquement : rien n'est affiché
 * sur mobile). Le bouton est désactivé tant que le modèle n'est pas téléchargé (paramètres).
 */
@Component({
  selector: 'app-import-societe',
  imports: [RouterLink, Icone],
  template: `
    @if (ia.etat.hasValue()) {
      @let e = ia.etat.value();
      @if (e) {
        <section class="carte" aria-labelledby="titre-import-societe">
          <h2 id="titre-import-societe">Pré-remplir avec l’IA locale</h2>
          <p class="muted">
            Choisissez les statuts ou un extrait Kbis au format PDF contenant du texte : le modèle, exécuté sur cet
            ordinateur, en lit les informations. L’analyse prend de une à quelques minutes ; vous relirez le formulaire
            avant d’enregistrer.
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
              <button #boutonAnnuler type="button" class="btn" (click)="annuler()">Annuler</button>
            </div>
          } @else if (e.installe) {
            <button #boutonImport type="button" class="btn" (click)="analyser()"><app-icone nom="societe" /> Importer des statuts ou un Kbis (PDF)…</button>
          } @else {
            <button type="button" class="btn" disabled aria-describedby="aide-import-societe">
              <app-icone nom="societe" /> Importer des statuts ou un Kbis (PDF)…
            </button>
            <p id="aide-import-societe" class="muted">
              Téléchargez d’abord le modèle dans les <a routerLink="/parametres">paramètres</a>.
            </p>
          }
        </section>
      }
    }
  `,
})
export class ImportSocieteIa {
  protected readonly ia = inject(IaLocale);
  private readonly notifications = inject(Notifications);

  private readonly injector = inject(Injector);
  private readonly boutonImport = viewChild<ElementRef<HTMLButtonElement>>('boutonImport');
  private readonly boutonAnnuler = viewChild<ElementRef<HTMLButtonElement>>('boutonAnnuler');

  /** Émis à la fin d'une analyse réussie ; le parent déplace alors le focus (ce bloc redevient un bouton). */
  readonly importe = output<ImportSociete>();
  protected readonly progression = signal<EtapeAnalyse | null>(null);
  /** Analyse en cours, interrompue par « Annuler » ou en quittant la page. */
  private analyse: AbortController | null = null;

  private detruit = false;

  constructor() {
    // Quitter la page interrompt l'analyse en cours (le modèle reste chargé jusqu'à « Libérer la mémoire »).
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.analyse?.abort();
    });
  }

  protected annuler() {
    this.analyse?.abort();
  }

  protected async analyser() {
    const analyse = new AbortController();
    this.analyse = analyse;
    const chemin = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Statuts ou Kbis (PDF)', extensions: ['pdf'] }],
    });
    // Page quittée pendant le choix du fichier : rien à faire.
    if (!chemin || analyse.signal.aborted) return;
    const fichier = chemin.split(/[\\/]/).pop() ?? chemin;
    // Le bouton cliqué est remplacé par le bloc de progression : le focus suit sur « Annuler ».
    this.progression.set({ etape: 'Lecture du document…' });
    this.focaliser(this.boutonAnnuler);
    try {
      const { sortie, reduit } = await this.ia.analyserDocument(
        chemin,
        EXTRACTION_SOCIETE,
        (e) => this.progression.set(e),
        analyse.signal,
      );
      const { donnees, champsIgnores } = analyserReponseSociete(sortie);
      // `analyserDocument` rejette une analyse annulée : on n'émet jamais après la destruction.
      this.importe.emit({ fichier, donnees, champsIgnores, reduit });
    } catch (e) {
      // Annulation (bouton ou page quittée) : pas d'erreur à afficher, sur cette page ou une autre.
      if (!analyse.signal.aborted) this.notifications.erreur(e);
      // « Annuler » disparaît : le focus revient au bouton d'import (sauf page quittée).
      this.focaliser(this.boutonImport);
    } finally {
      this.progression.set(null);
      if (this.analyse === analyse) this.analyse = null;
    }
  }

  /** Focus après le prochain rendu (l'élément visé n'existe qu'une fois le bloc mis à jour). */
  private focaliser(cible: () => ElementRef<HTMLElement> | undefined) {
    if (this.detruit) return;
    afterNextRender(() => cible()?.nativeElement.focus(), { injector: this.injector });
  }
}
