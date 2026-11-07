import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LIBELLES_TYPE_BAIL, type StatutBail } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Icone } from '../../ui/icone';
import { BadgeStatutBail } from './statut-bail';
import { Vide } from '../../ui/vide';

@Component({
  selector: 'app-baux-liste',
  imports: [RouterLink, Icone, BadgeStatutBail, Vide, CurrencyPipe, DatePipe, LibellePipe],
  template: `
    <header class="entete">
      <h1>Baux</h1>
      <a class="btn primaire" routerLink="/baux/nouveau"><app-icone nom="plus" /> Nouveau bail</a>
    </header>

    <div class="filtres">
      @for (f of filtresDispo; track f.valeur) {
        <button class="puce" [class.active]="filtre() === f.valeur" [attr.aria-pressed]="filtre() === f.valeur" (click)="filtre.set(f.valeur)">{{ f.libelle }} ({{ compte(f.valeur) }})</button>
      }
    </div>

    @if (filtres().length === 0) {
      <app-vide message="Aucun bail à afficher.">
        <a class="btn primaire" routerLink="/baux/nouveau">Créer un bail</a>
      </app-vide>
    } @else {
      <div class="cartes">
        @for (b of filtres(); track b.id) {
          <a class="carte lien" [routerLink]="['/baux', b.id]">
            <div class="ligne-titre">
              <strong>{{ b.bien_libelle }}</strong>
              <app-statut-bail [statut]="b.statut" />
            </div>
            <p>{{ b.locataires_noms || 'Locataire non renseigné' }}</p>
            <p class="muted">{{ b.type_bail | libelle: typesBail }}@if (b.reference) { · {{ b.reference }} }</p>
            <div class="chiffres">
              <span>Depuis le {{ b.date_debut | date: 'dd/MM/yyyy' }}@if (b.date_sortie) { jusqu’au {{ b.date_sortie | date: 'dd/MM/yyyy' }} }</span>
              <span><b>{{ b.loyer_hc + b.charges | currency: 'EUR' }}</b> CC</span>
              <span>{{ b.detenteur === 'societe' ? b.societe_nom : 'Nom propre' }}</span>
            </div>
          </a>
        }
      </div>
    }
  `,
})
export class BauxListe {
  private readonly bdd = inject(BaseDeDonnees);
  private readonly liste = resource({ loader: () => this.bdd.depot.baux.listerResumes() });
  protected readonly baux = computed(() => (this.liste.hasValue() ? this.liste.value() : []));
  /** Filtre par défaut : les baux en cours s'il y en a, sinon tous ; modifiable par l'utilisateur. */
  protected readonly filtre = linkedSignal<StatutBail | 'tous'>(() =>
    this.baux().some((b) => b.statut === 'actif') || !this.liste.hasValue() ? 'actif' : 'tous',
  );
  protected readonly typesBail = LIBELLES_TYPE_BAIL;
  protected readonly filtresDispo: { valeur: StatutBail | 'tous'; libelle: string }[] = [
    { valeur: 'actif', libelle: 'En cours' },
    { valeur: 'brouillon', libelle: 'Brouillons' },
    { valeur: 'termine', libelle: 'Terminés' },
    { valeur: 'tous', libelle: 'Tous' },
  ];

  protected readonly filtres = computed(() =>
    this.filtre() === 'tous' ? this.baux() : this.baux().filter((b) => b.statut === this.filtre()),
  );

  protected compte(f: StatutBail | 'tous') {
    return f === 'tous' ? this.baux().length : this.baux().filter((b) => b.statut === f).length;
  }
}
