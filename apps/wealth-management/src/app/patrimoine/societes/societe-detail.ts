import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LIBELLES_TYPE_BIEN, nomComplet, type Associe } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Notifications } from '../../ui/notifications.service';
import { Fiche } from '../../ui/fiche/fiche.component';
import { idRoute } from '../../ui/route';
import { Icone } from '../../ui/icone';
import { Vide } from '../../ui/vide';
import { CHAMPS_SOCIETE } from './societe.champs';
import { AssocieForm } from './associe-form';

@Component({
  selector: 'app-societe-detail',
  imports: [RouterLink, Fiche, AssocieForm, Icone, Vide, CurrencyPipe, DatePipe, LibellePipe],
  template: `
    @if (societe(); as s) {
      <header class="entete">
        <div>
          <a class="retour" routerLink="/societes">← Sociétés</a>
          <h1>{{ s.raison_sociale }}</h1>
        </div>
        <div class="actions">
          <a class="btn" [routerLink]="['/societes', s.id, 'modifier']"><app-icone nom="modifier" /> Modifier</a>
          <button class="btn danger" (click)="supprimer()" aria-label="Supprimer la société" title="Supprimer la société"><app-icone nom="supprimer" /></button>
        </div>
      </header>

      <app-fiche [champs]="champs" [valeur]="$any(s)" />

      <section class="carte">
        <div class="ligne-titre">
          <h2>Associés & répartition du capital</h2>
          <button class="btn petit" (click)="ajoutAssocie.set(!ajoutAssocie())" [attr.aria-expanded]="ajoutAssocie()" aria-controls="ajout-associe"><app-icone nom="plus" /> Associé</button>
        </div>
        @if (ajoutAssocie()) {
          <app-associe-form id="ajout-associe" [societeId]="s.id" (enregistre)="associeAjoute()" (annule)="ajoutAssocie.set(false)" />
        }
        @if (associes().length) {
          <div class="tableau" tabindex="0" role="region" aria-label="Associés">
            <table>
              <thead><tr><th>Associé</th><th class="num">Parts</th><th class="num">%</th><th>Entrée</th><th></th></tr></thead>
              <tbody>
                @for (a of associes(); track a.id) {
                  <tr>
                    <td>{{ nom(a) }} @if (a.est_gerant) { <span class="badge gris">Gérant</span> }</td>
                    <td class="num">{{ a.nombre_parts }}</td>
                    <td class="num">{{ pourcentage(a) }}</td>
                    <td>{{ a.date_entree | date: 'dd/MM/yyyy' }}</td>
                    <td class="num"><button class="btn lien-danger" (click)="supprimerAssocie(a)" [attr.aria-label]="'Retirer ' + nom(a)">Retirer</button></td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td>Total</td><td class="num">{{ totalParts() }}@if (s.nombre_parts) { / {{ s.nombre_parts }} }</td><td></td><td></td><td></td></tr>
              </tfoot>
            </table>
          </div>
          @if (s.nombre_parts && totalParts() !== s.nombre_parts) {
            <p class="alerte">La somme des parts des associés ({{ totalParts() }}) ne correspond pas au nombre de parts de la société ({{ s.nombre_parts }}).</p>
          }
        } @else if (!ajoutAssocie()) {
          <p class="muted">Aucun associé renseigné.</p>
        }
      </section>

      <section class="carte">
        <div class="ligne-titre">
          <h2>Biens détenus</h2>
          <a class="btn petit" routerLink="/biens/nouveau" [queryParams]="{ societe: s.id }"><app-icone nom="plus" /> Bien</a>
        </div>
        @if (biens().length) {
          <ul class="liste" role="list">
            @for (b of biens(); track b.id) {
              <li>
                <a [routerLink]="['/biens', b.id]">
                  <strong>{{ b.libelle }}</strong>
                  <span class="muted">{{ b.type_bien | libelle: typesBien }} · {{ b.ville }}</span>
                  @if (b.bail_actif_id) {
                    <span class="badge vert">Loué {{ b.loyer_actuel | currency: 'EUR' }}</span>
                  } @else {
                    <span class="badge gris">Vacant</span>
                  }
                </a>
              </li>
            }
          </ul>
        } @else {
          <app-vide message="Aucun bien rattaché à cette société." />
        }
      </section>
    } @else if (donnees.error()) {
      <p class="alerte">Société introuvable.</p>
    }
  `,
})
export class SocieteDetail {
  readonly id = input(null, { transform: idRoute });
  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected readonly champs = CHAMPS_SOCIETE;
  protected readonly typesBien = LIBELLES_TYPE_BIEN;
  protected readonly ajoutAssocie = signal(false);

  protected readonly donnees = resource({
    params: () => this.id() ?? undefined,
    loader: async ({ params: id }) => {
      const depot = this.bdd.depot;
      const [societe, biens] = await Promise.all([depot.societes.exiger(id), depot.biens.listerResumes({ societeId: id })]);
      return { societe, biens };
    },
  });
  protected readonly listeAssocies = resource({
    params: () => this.id() ?? undefined,
    loader: ({ params: id }) => this.bdd.depot.societes.listerAssocies(id),
  });

  protected readonly societe = computed(() => (this.donnees.hasValue() ? this.donnees.value().societe : null));
  protected readonly biens = computed(() => (this.donnees.hasValue() ? this.donnees.value().biens : []));
  protected readonly associes = computed(() => (this.listeAssocies.hasValue() ? this.listeAssocies.value() : []));
  protected readonly totalParts = computed(() => this.associes().reduce((t, a) => t + (a.nombre_parts || 0), 0));

  protected nom(a: Associe) {
    return nomComplet(a, true);
  }

  protected pourcentage(a: Associe): string {
    const total = this.societe()?.nombre_parts || this.totalParts();
    return total ? `${((a.nombre_parts / total) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %` : '';
  }

  protected associeAjoute() {
    this.ajoutAssocie.set(false);
    this.listeAssocies.reload();
  }

  async supprimerAssocie(a: Associe) {
    if (!(await this.notifications.confirmer(`Retirer ${this.nom(a)} des associés ?`))) return;
    try {
      await this.bdd.depot.societes.associes.supprimer(a.id);
      this.notifications.succes('Associé retiré');
    } catch (err) {
      this.notifications.erreur(err);
    }
    this.listeAssocies.reload();
  }

  async supprimer() {
    const s = this.societe();
    if (!s || !(await this.notifications.confirmer(`Supprimer définitivement « ${s.raison_sociale} » ?`))) return;
    try {
      await this.bdd.depot.societes.supprimer(s.id);
      this.notifications.succes('Société supprimée');
      this.router.navigate(['/societes']);
    } catch (e) {
      this.notifications.erreur(e);
    }
  }
}
