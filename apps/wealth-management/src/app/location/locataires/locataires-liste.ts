import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { age, aujourdhui } from '@wealth-management/core';
import type { LocataireResume } from '@wealth-management/db';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Icone } from '../../ui/icone';
import { Vide } from '../../ui/vide';
import { LigneCliquable } from '../../ui/ligne-cliquable';

@Component({
  selector: 'app-locataires-liste',
  imports: [RouterLink, Icone, Vide, LigneCliquable],
  template: `
    <header class="entete">
      <h1>Locataires</h1>
      <a class="btn primaire" routerLink="/locataires/nouveau"><app-icone nom="plus" /> Nouveau locataire</a>
    </header>

    <div class="filtres">
      <button class="puce" [class.active]="filtre() === 'tous'" [attr.aria-pressed]="filtre() === 'tous'" (click)="filtre.set('tous')">Tous ({{ locataires().length }})</button>
      <button class="puce" [class.active]="filtre() === 'actuels'" [attr.aria-pressed]="filtre() === 'actuels'" (click)="filtre.set('actuels')">En place</button>
      <button class="puce" [class.active]="filtre() === 'anciens'" [attr.aria-pressed]="filtre() === 'anciens'" (click)="filtre.set('anciens')">Anciens / candidats</button>
      <input class="recherche" type="search" placeholder="Rechercher…" aria-label="Rechercher un locataire" enterkeyhint="search" autocapitalize="off" spellcheck="false" (input)="recherche.set($any($event.target).value)" />
    </div>

    @if (filtres().length === 0) {
      <app-vide message="Aucun locataire à afficher." />
    } @else {
      <div class="tableau carte" tabindex="0" role="region" aria-label="Liste des locataires">
        <table>
          <thead><tr><th>Nom</th><th>Âge</th><th>Contact</th><th>Logement actuel</th><th class="num">Baux</th></tr></thead>
          <tbody>
            @for (l of filtres(); track l.id) {
              <tr appLigneCliquable>
                <td><a [routerLink]="['/locataires', l.id]"><strong>{{ l.nom.toUpperCase() }}</strong> {{ l.prenom }}</a></td>
                <td>{{ ageDe(l) }}</td>
                <td class="muted">{{ l.telephone || l.email }}</td>
                <td>
                  @if (l.bien_actuel) {
                    <span class="badge vert">{{ l.bien_actuel }}</span>
                  } @else {
                    <span class="muted">—</span>
                  }
                </td>
                <td class="num">{{ l.nb_baux }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class LocatairesListe {
  private readonly bdd = inject(BaseDeDonnees);
  private readonly liste = resource({ loader: () => this.bdd.depot.locataires.listerResumes() });
  protected readonly locataires = computed(() => (this.liste.hasValue() ? this.liste.value() : []));
  protected readonly filtre = signal<'tous' | 'actuels' | 'anciens'>('tous');
  protected readonly recherche = signal('');
  private readonly jour = aujourdhui();

  protected readonly filtres = computed(() => {
    const q = this.recherche().toLowerCase().trim();
    return this.locataires().filter((l) => {
      if (this.filtre() === 'actuels' && !l.bail_actif_id) return false;
      if (this.filtre() === 'anciens' && l.bail_actif_id) return false;
      return !q || `${l.nom} ${l.prenom} ${l.email ?? ''} ${l.telephone ?? ''}`.toLowerCase().includes(q);
    });
  });

  protected ageDe(l: LocataireResume) {
    return l.date_naissance ? `${age(l.date_naissance, this.jour)} ans` : '';
  }
}
