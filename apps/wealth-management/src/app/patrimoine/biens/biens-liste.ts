import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LIBELLES_TYPE_BIEN, formatAdresse } from '@wealth-management/core';
import type { BienResume } from '@wealth-management/db';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Icone } from '../../ui/icone';
import { Vide } from '../../ui/vide';

type Filtre = 'tous' | 'personnel' | `societe:${number}`;

@Component({
  selector: 'app-biens-liste',
  imports: [RouterLink, Icone, Vide, CurrencyPipe, LibellePipe],
  template: `
    <header class="entete">
      <h1>Biens</h1>
      <a class="btn primaire" routerLink="/biens/nouveau"><app-icone nom="plus" /> Nouveau bien</a>
    </header>

    <div class="filtres">
      <button class="puce" [class.active]="filtre() === 'tous'" [attr.aria-pressed]="filtre() === 'tous'" (click)="filtre.set('tous')">Tous ({{ biens().length }})</button>
      <button class="puce" [class.active]="filtre() === 'personnel'" [attr.aria-pressed]="filtre() === 'personnel'" (click)="filtre.set('personnel')">En nom propre</button>
      @for (s of societes(); track s.id) {
        <button class="puce" [class.active]="filtre() === 'societe:' + s.id" [attr.aria-pressed]="filtre() === 'societe:' + s.id" (click)="filtre.set($any('societe:' + s.id))">{{ s.nom }}</button>
      }
      <input class="recherche" type="search" placeholder="Rechercher…" aria-label="Rechercher un bien" enterkeyhint="search" autocapitalize="off" spellcheck="false" [value]="recherche()" (input)="recherche.set($any($event.target).value)" />
    </div>

    @if (filtres().length === 0) {
      <app-vide message="Aucun bien à afficher.">
        <a class="btn primaire" routerLink="/biens/nouveau">Ajouter un bien</a>
      </app-vide>
    } @else {
      <div class="cartes">
        @for (b of filtres(); track b.id) {
          <a class="carte lien" [routerLink]="['/biens', b.id]">
            <div class="ligne-titre">
              <strong>{{ b.libelle }}</strong>
              @if (b.bail_actif_id) {
                <span class="badge vert">Loué</span>
              } @else {
                <span class="badge gris">Vacant</span>
              }
            </div>
            <p class="muted">{{ b.type_bien | libelle: typesBien }}@if (b.surface_habitable) { · {{ b.surface_habitable }} m² }@if (b.nb_pieces) { · {{ b.nb_pieces }} p. }</p>
            <p class="muted">{{ adresse(b) }}</p>
            <div class="chiffres">
              <span>{{ b.detenteur === 'societe' ? b.societe_nom : 'Nom propre' }}</span>
              @if (b.locataires_actuels) {
                <span>{{ b.locataires_actuels }}</span>
              }
              @if (b.loyer_actuel) {
                <span><b>{{ b.loyer_actuel | currency: 'EUR' }}</b> / mois</span>
              }
            </div>
          </a>
        }
      </div>
    }
  `,
})
export class BiensListe {
  private readonly bdd = inject(BaseDeDonnees);
  private readonly liste = resource({ loader: () => this.bdd.depot.biens.listerResumes() });
  protected readonly biens = computed(() => (this.liste.hasValue() ? this.liste.value() : []));
  protected readonly filtre = signal<Filtre>('tous');
  protected readonly recherche = signal('');
  protected readonly typesBien = LIBELLES_TYPE_BIEN;

  protected readonly societes = computed(() => {
    const m = new Map<number, string>();
    for (const b of this.biens()) if (b.societe_id) m.set(b.societe_id, b.societe_nom ?? '');
    return [...m].map(([id, nom]) => ({ id, nom }));
  });

  protected readonly filtres = computed(() => {
    const f = this.filtre();
    const q = this.recherche().toLowerCase().trim();
    return this.biens().filter((b) => {
      if (f === 'personnel' && b.detenteur !== 'personnel') return false;
      if (f.startsWith('societe:') && b.societe_id !== Number(f.slice(8))) return false;
      if (q && ![b.libelle, b.ville, b.adresse_ligne1, b.locataires_actuels].some((x) => x?.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  protected adresse(b: BienResume) {
    return formatAdresse(b);
  }
}
