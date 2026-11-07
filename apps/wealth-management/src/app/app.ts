import { Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { BaseDeDonnees } from './infrastructure/base-de-donnees.service';
import { Notifications } from './ui/notifications.service';
import { Icone } from './ui/icone';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icone],
  styleUrl: './app.css',
  host: { '(document:keydown.escape)': 'fermerMenu()' },
  template: `
    <a class="evitement visuellement-masque" href="#contenu" (click)="allerAuContenu($event)">Aller au contenu</a>

    <header class="barre-mobile" [attr.inert]="menuOuvert() ? '' : null">
      <button
        #boutonMenu
        class="btn icone-seule"
        (click)="ouvrirMenu()"
        aria-label="Menu"
        aria-controls="navigation"
        [attr.aria-expanded]="menuOuvert()"
      >
        <app-icone nom="menu" />
      </button>
      <strong>Wealth Management</strong>
    </header>

    <nav #navigation id="navigation" class="navigation" aria-label="Navigation principale" [class.ouverte]="menuOuvert()">
      <div class="marque">
        <span class="logo">G</span>
        <div><strong>Wealth Management</strong><small>Gestion de patrimoine</small></div>
      </div>
      @for (l of liens; track l.chemin) {
        <a [routerLink]="l.chemin" routerLinkActive="actif" [routerLinkActiveOptions]="{ exact: l.chemin === '/' }">
          <app-icone [nom]="l.icone" />
          <span>{{ l.libelle }}</span>
        </a>
      }
    </nav>
    @if (menuOuvert()) {
      <div class="voile" aria-hidden="true" (click)="fermerMenu()"></div>
    }

    <main #contenu id="contenu" class="contenu" tabindex="-1" [attr.inert]="menuOuvert() ? '' : null">
      @switch (bdd.etat()) {
        @case ('pret') {
          <router-outlet />
        }
        @case ('erreur') {
          <div class="carte erreur-bdd">
            <h2>Base de données indisponible</h2>
            <p>{{ bdd.erreur() }}</p>
          </div>
        }
        @default {
          <p class="chargement">Chargement…</p>
        }
      }
    </main>

    <div #zoneNotifications class="notifications" popover="manual" aria-live="polite">
      @for (n of notifications.liste(); track n.id) {
        <div class="notification" [class]="n.type" animate.leave="sortie">
          <span>{{ n.message }}</span>
          <button type="button" class="btn petit icone-seule fermer" (click)="notifications.fermer(n.id)" aria-label="Fermer la notification">
            <app-icone nom="fermer" [taille]="16" />
          </button>
        </div>
      }
    </div>
  `,
})
export class App {
  protected readonly bdd = inject(BaseDeDonnees);
  protected readonly notifications = inject(Notifications);
  protected readonly menuOuvert = signal(false);

  private readonly injector = inject(Injector);
  private readonly boutonMenu = viewChild.required<ElementRef<HTMLButtonElement>>('boutonMenu');
  private readonly navigation = viewChild.required<ElementRef<HTMLElement>>('navigation');
  private readonly zoneNotifications = viewChild.required<ElementRef<HTMLElement>>('zoneNotifications');
  private readonly contenu = viewChild.required<ElementRef<HTMLElement>>('contenu');

  protected readonly liens = [
    { chemin: '/', libelle: 'Tableau de bord', icone: 'accueil' },
    { chemin: '/loyers', libelle: 'Loyers', icone: 'loyer' },
    { chemin: '/baux', libelle: 'Baux', icone: 'bail' },
    { chemin: '/biens', libelle: 'Biens', icone: 'bien' },
    { chemin: '/locataires', libelle: 'Locataires', icone: 'locataire' },
    { chemin: '/societes', libelle: 'Sociétés', icone: 'societe' },
    { chemin: '/parametres', libelle: 'Paramètres', icone: 'reglages' },
  ];

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.menuOuvert.set(false));

    // Le tiroir n'existe qu'en mobile : repasser en large le referme (sinon `main` resterait inerte).
    const mobile = matchMedia('(max-width: 900px)');
    const surChangement = () => this.menuOuvert.set(false);
    mobile.addEventListener('change', surChangement);
    inject(DestroyRef).onDestroy(() => mobile.removeEventListener('change', surChangement));

    // Zone de notifications dans la top layer, ouverte une fois pour toutes (popover `manual`).
    afterNextRender(() => this.zoneNotifications().nativeElement.showPopover());
  }

  /** Lien d'évitement : `href="#contenu"` naviguerait vers `/#contenu` (base href), on déplace le focus nous-mêmes. */
  protected allerAuContenu(event: Event) {
    event.preventDefault();
    const contenu = this.contenu().nativeElement;
    // Cible : le titre de la page (focusable par script seulement), sinon <main>.
    const cible = contenu.querySelector<HTMLElement>('h1') ?? contenu;
    cible.tabIndex = -1;
    cible.focus();
  }

  /** Ouvre le tiroir et place le focus sur le premier lien. */
  protected ouvrirMenu() {
    this.menuOuvert.set(true);
    afterNextRender(() => this.navigation().nativeElement.querySelector('a')?.focus(), { injector: this.injector });
  }

  /** Ferme le tiroir (Échap, voile) et rend le focus au bouton Menu. */
  protected fermerMenu() {
    if (!this.menuOuvert()) return;
    this.menuOuvert.set(false);
    afterNextRender(() => this.boutonMenu().nativeElement.focus(), { injector: this.injector });
  }
}
