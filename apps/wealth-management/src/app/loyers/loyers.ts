import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { arrondi, aujourdhui, periodeDe, periodeSuivante, resteDu, statutEcheance, totalEcheance } from '@wealth-management/core';
import type { EcheanceDetaillee } from '@wealth-management/db';
import { BaseDeDonnees } from '../infrastructure/base-de-donnees.service';
import { Notifications } from '../ui/notifications.service';
import { Icone } from '../ui/icone';
import { BadgeStatutEcheance } from './statut-echeance';
import { Vide } from '../ui/vide';

@Component({
  selector: 'app-loyers',
  imports: [RouterLink, Icone, BadgeStatutEcheance, Vide, CurrencyPipe, DatePipe],
  styleUrl: './loyers.css',
  template: `
    <header class="entete">
      <h1>Loyers</h1>
      <div class="navigateur-mois">
        <button class="btn icone-seule" (click)="decaler(-1)" aria-label="Mois précédent"><app-icone nom="retour" /></button>
        <strong>{{ periode() | date: 'MMMM y' }}</strong>
        <button class="btn icone-seule" (click)="decaler(1)" [disabled]="periode() >= periodeCourante" aria-label="Mois suivant"><app-icone nom="suivant" /></button>
      </div>
    </header>

    <div class="kpis">
      <div class="kpi"><span>Attendu</span><strong>{{ totaux().attendu | currency: 'EUR' }}</strong></div>
      <div class="kpi"><span>Encaissé</span><strong>{{ totaux().encaisse | currency: 'EUR' }}</strong></div>
      <div class="kpi" [class.alerte-kpi]="totaux().reste > 0"><span>Reste à encaisser</span><strong>{{ totaux().reste | currency: 'EUR' }}</strong></div>
    </div>

    <section class="carte">
      @if (echeances().length === 0) {
        <app-vide message="Aucune échéance pour ce mois." />
      } @else {
        <div class="tableau" tabindex="0" role="region" aria-label="Échéances du mois">
          <table>
            <thead><tr><th>Bien</th><th>Locataire(s)</th><th>Échéance</th><th class="num">Dû</th><th class="num">Payé</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              @for (e of echeances(); track e.id) {
                <tr>
                  <td><a [routerLink]="['/baux', e.bail_id]">{{ e.bien_libelle }}</a></td>
                  <td>{{ e.locataires_noms }}</td>
                  <td>{{ e.date_echeance | date: 'dd/MM/yyyy' }}</td>
                  <td class="num">{{ total(e) | currency: 'EUR' }}</td>
                  <td class="num">{{ e.total_paye | currency: 'EUR' }}</td>
                  <td><app-statut-echeance [statut]="statut(e)" /></td>
                  <td class="num">
                    @if (reste(e) > 0) {
                      <button class="btn petit primaire" (click)="solder(e)" [attr.aria-label]="'Encaisser ' + e.bien_libelle">Encaisser</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (impayesAnterieurs().length) {
      <section class="carte">
        <h2>Impayés des mois précédents</h2>
        <ul class="liste" role="list">
          @for (e of impayesAnterieurs(); track e.id) {
            <li>
              <a [routerLink]="['/baux', e.bail_id]">
                <strong>{{ e.bien_libelle }}</strong>
                <span class="muted">{{ e.locataires_noms }} · {{ e.periode | date: 'MMMM y' }}</span>
                <span class="badge rouge">{{ reste(e) | currency: 'EUR' }}</span>
              </a>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class Loyers {
  private readonly bdd = inject(BaseDeDonnees);
  private readonly notifications = inject(Notifications);
  protected readonly jour = aujourdhui();
  protected readonly periodeCourante = periodeDe(this.jour);
  protected readonly periode = signal(this.periodeCourante);

  /** Échéances du mois affiché, rechargées à chaque changement de période. */
  private readonly echeancesMois = resource({
    params: () => this.periode(),
    loader: ({ params: periode }) => this.bdd.depot.loyers.listerParPeriode(periode),
  });
  private readonly impayesListe = resource({ loader: () => this.bdd.depot.loyers.listerImpayes(this.jour) });

  protected readonly echeances = computed(() => (this.echeancesMois.hasValue() ? this.echeancesMois.value() : []));
  private readonly impayes = computed(() => (this.impayesListe.hasValue() ? this.impayesListe.value() : []));

  protected readonly impayesAnterieurs = computed(() => this.impayes().filter((e) => e.periode < this.periode()));
  protected readonly totaux = computed(() => {
    const attendu = arrondi(this.echeances().reduce((t, e) => t + totalEcheance(e), 0));
    const encaisse = arrondi(this.echeances().reduce((t, e) => t + e.total_paye, 0));
    return { attendu, encaisse, reste: Math.max(0, arrondi(attendu - encaisse)) };
  });

  protected decaler(n: number) {
    this.periode.update((p) => periodeSuivante(p, n));
  }

  protected total(e: EcheanceDetaillee) {
    return totalEcheance(e);
  }

  protected reste(e: EcheanceDetaillee) {
    return resteDu(e, e.total_paye);
  }

  protected statut(e: EcheanceDetaillee) {
    return statutEcheance(e, e.total_paye, this.jour);
  }

  protected async solder(e: EcheanceDetaillee) {
    try {
      const id = await this.bdd.depot.loyers.solder(e.id, this.jour);
      if (id === null) this.notifications.info(`Échéance déjà soldée : ${e.bien_libelle}`);
      else this.notifications.succes(`Loyer encaissé : ${e.bien_libelle}`);
      this.echeancesMois.reload();
      this.impayesListe.reload();
    } catch (err) {
      this.notifications.erreur(err);
    }
  }
}
