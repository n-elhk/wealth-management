import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LIBELLES_FORME_JURIDIQUE } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Icone } from '../../ui/icone';
import { Vide } from '../../ui/vide';

@Component({
  selector: 'app-societes-liste',
  imports: [RouterLink, Icone, Vide, CurrencyPipe, DatePipe, LibellePipe],
  template: `
    <header class="entete">
      <h1>Sociétés</h1>
      <a class="btn primaire" routerLink="/societes/nouvelle"><app-icone nom="plus" /> Nouvelle société</a>
    </header>

    @if (liste.isLoading()) {
      <p class="chargement">Chargement…</p>
    } @else if (societes().length === 0) {
      <app-vide message="Aucune société. Créez votre SCI ou SARL de famille pour y rattacher des biens.">
        <a class="btn primaire" routerLink="/societes/nouvelle">Créer une société</a>
      </app-vide>
    } @else {
      <div class="cartes">
        @for (s of societes(); track s.id) {
          <a class="carte lien" [routerLink]="['/societes', s.id]">
            <div class="ligne-titre">
              <strong>{{ s.raison_sociale }}</strong>
              <span class="badge gris">{{ s.forme_juridique | libelle: formes }}</span>
            </div>
            <p class="muted">{{ s.ville || '—' }}@if (s.date_creation) { · créée le {{ s.date_creation | date: 'dd/MM/yyyy' }} }</p>
            <div class="chiffres">
              <span><b>{{ s.nb_biens }}</b> bien(s)</span>
              @if (s.nombre_parts) {
                <span><b>{{ s.parts_attribuees }}</b> / {{ s.nombre_parts }} parts attribuées</span>
              }
              @if (s.capital) {
                <span>Capital <b>{{ s.capital | currency: 'EUR' }}</b></span>
              }
            </div>
          </a>
        }
      </div>
    }
  `,
})
export class SocietesListe {
  private readonly bdd = inject(BaseDeDonnees);
  protected readonly formes = LIBELLES_FORME_JURIDIQUE;

  private readonly liste = resource({ loader: () => this.bdd.depot.societes.listerResumes() });
  protected readonly societes = computed(() => (this.liste.hasValue() ? this.liste.value() : []));
}
