import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LIBELLES_TYPE_BAIL, age, aujourdhui, nomComplet } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Notifications } from '../../ui/notifications.service';
import { Fiche } from '../../ui/fiche/fiche.component';
import { idRoute } from '../../ui/route';
import { Icone } from '../../ui/icone';
import { BadgeStatutBail } from '../baux/statut-bail';
import { Vide } from '../../ui/vide';
import { LigneCliquable } from '../../ui/ligne-cliquable';
import { CHAMPS_LOCATAIRE } from './locataire.champs';

@Component({
  selector: 'app-locataire-detail',
  imports: [RouterLink, LigneCliquable, Fiche, Icone, BadgeStatutBail, Vide, CurrencyPipe, DatePipe, LibellePipe],
  template: `
    @if (locataire(); as l) {
      <header class="entete">
        <div>
          <a class="retour" routerLink="/locataires">← Locataires</a>
          <h1>{{ nom() }}</h1>
          @if (l.date_naissance) {
            <p class="muted">{{ ageTexte() }}</p>
          }
        </div>
        <div class="actions">
          <a class="btn" [routerLink]="['/locataires', l.id, 'modifier']"><app-icone nom="modifier" /> Modifier</a>
          <button class="btn danger" (click)="supprimer()" aria-label="Supprimer le locataire" title="Supprimer le locataire"><app-icone nom="supprimer" /></button>
        </div>
      </header>

      <section class="carte">
        <h2>Historique des baux</h2>
        @if (baux().length) {
          <div class="tableau" tabindex="0" role="region" aria-label="Historique des baux">
            <table>
              <thead><tr><th>Bien</th><th>Type</th><th>Entrée</th><th>Sortie</th><th class="num">Loyer CC</th><th>Statut</th></tr></thead>
              <tbody>
                @for (b of baux(); track b.id) {
                  <tr appLigneCliquable>
                    <td><a [routerLink]="['/baux', b.id]">{{ b.bien_libelle }}</a></td>
                    <td>{{ b.type_bail | libelle: typesBail }}</td>
                    <td>{{ b.date_debut | date: 'dd/MM/yyyy' }}</td>
                    <td>{{ b.date_sortie | date: 'dd/MM/yyyy' }}</td>
                    <td class="num">{{ b.loyer_hc + b.charges | currency: 'EUR' }}</td>
                    <td><app-statut-bail [statut]="b.statut" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <app-vide message="Aucun bail pour ce locataire.">
            <a class="btn primaire" routerLink="/baux/nouveau" [queryParams]="{ locataire: l.id }">Créer un bail</a>
          </app-vide>
        }
      </section>

      <app-fiche [champs]="champs" [valeur]="$any(l)" />
    } @else if (donnees.error()) {
      <p class="alerte">Locataire introuvable.</p>
    }
  `,
})
export class LocataireDetail {
  readonly id = input(null, { transform: idRoute });
  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected readonly champs = CHAMPS_LOCATAIRE;
  protected readonly typesBail = LIBELLES_TYPE_BAIL;

  protected readonly donnees = resource({
    params: () => this.id() ?? undefined,
    loader: async ({ params: id }) => {
      const [locataire, baux] = await Promise.all([
        this.bdd.depot.locataires.exiger(id),
        this.bdd.depot.baux.listerResumes({ locataireId: id }),
      ]);
      return { locataire, baux };
    },
  });

  protected readonly locataire = computed(() => (this.donnees.hasValue() ? this.donnees.value().locataire : null));
  protected readonly baux = computed(() => (this.donnees.hasValue() ? this.donnees.value().baux : []));
  protected readonly nom = computed(() => {
    const l = this.locataire();
    return l ? nomComplet(l, true) : '';
  });
  protected readonly ageTexte = computed(() => {
    const d = this.locataire()?.date_naissance;
    return d ? `${age(d, aujourdhui())} ans` : '';
  });

  async supprimer() {
    const l = this.locataire();
    if (!l || !(await this.notifications.confirmer(`Supprimer définitivement ${this.nom()} ?`))) return;
    try {
      await this.bdd.depot.locataires.supprimer(l.id);
      this.notifications.succes('Locataire supprimé');
      this.router.navigate(['/locataires']);
    } catch (e) {
      this.notifications.erreur(e);
    }
  }
}
