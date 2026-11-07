import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ajouterJours,
  aujourdhui,
  dateFinContractuelle,
  periodeDe,
  prochaineDateRevision,
  resteDu,
} from '@wealth-management/core';
import type { BailResume, EcheanceDetaillee, TableauDeBord as Stats } from '@wealth-management/db';
import { BaseDeDonnees } from '../infrastructure/base-de-donnees.service';
import { Icone } from '../ui/icone';
import { Vide } from '../ui/vide';

interface Alerte {
  date: string;
  texte: string;
  lien: unknown[];
}

@Component({
  selector: 'app-tableau-de-bord',
  imports: [RouterLink, Icone, Vide, CurrencyPipe, DatePipe],
  styleUrl: './tableau-de-bord.css',
  template: `
    <header class="entete">
      <div>
        <h1>Tableau de bord</h1>
        <p class="muted">{{ periode | date: 'MMMM y' }}</p>
      </div>
    </header>

    @if (stats(); as s) {
      @if (s.nb_biens === 0) {
        <section class="carte bienvenue">
          <h2>Bienvenue dans Wealth Management</h2>
          <ol>
            <li><a routerLink="/parametres">Renseignez votre identité de bailleur</a> (pour les biens en nom propre).</li>
            <li><a routerLink="/societes/nouvelle">Créez vos sociétés</a> (SCI, SARL de famille…) si besoin.</li>
            <li><a routerLink="/biens/nouveau">Ajoutez vos biens</a> et rattachez-les à vous ou à une société.</li>
            <li><a routerLink="/locataires/nouveau">Enregistrez vos locataires</a> puis <a routerLink="/baux/nouveau">créez les baux</a>.</li>
          </ol>
        </section>
      }

      <div class="kpis">
        <div class="kpi"><span>Loyers du mois</span><strong>{{ s.mois_encaisse | currency: 'EUR' }}</strong><small>sur {{ s.mois_attendu | currency: 'EUR' }} attendus</small>
          <progress class="jauge" [value]="s.mois_encaisse" [max]="s.mois_attendu || 1" aria-label="Taux d’encaissement du mois"></progress></div>
        <div class="kpi" [class.alerte-kpi]="s.impayes_total > 0"><span>Impayés</span><strong>{{ s.impayes_total | currency: 'EUR' }}</strong><small>{{ s.impayes_nb }} échéance(s)</small></div>
        <div class="kpi"><span>Occupation</span><strong>{{ s.nb_biens_loues }} / {{ s.nb_biens }}</strong><small>biens loués · {{ s.nb_locataires_actifs }} locataire(s)</small></div>
        <div class="kpi"><span>Encaissé {{ annee }}</span><strong>{{ s.annee_encaisse | currency: 'EUR' }}</strong><small>{{ s.nb_societes }} société(s)</small></div>
      </div>

      @if (s.historique.length) {
        <section class="carte">
          <h2 id="titre-encaissements">Encaissements — 12 derniers mois</h2>
          <figure aria-labelledby="titre-encaissements">
            <!-- Graphique purement visuel : les mêmes données sont dans le tableau masqué ci-dessous. -->
            <div class="histogramme" aria-hidden="true">
              @for (h of s.historique; track h.periode) {
                <div class="barre" [title]="(h.periode | date: 'MMMM y') + ' : ' + (h.encaisse | currency: 'EUR') + ' / ' + (h.attendu | currency: 'EUR')">
                  <div class="attendu" [style.height.%]="hauteur(h.attendu)">
                    <div class="encaisse" [style.height.%]="h.attendu ? (h.encaisse / h.attendu) * 100 : 0"></div>
                  </div>
                  <small>{{ h.periode | date: 'MMM' }}</small>
                </div>
              }
            </div>
            <figcaption class="legende" aria-hidden="true"><span class="pastille encaisse"></span> encaissé <span class="pastille attendu"></span> attendu</figcaption>
            <table class="visuellement-masque">
              <caption>Encaissé et attendu par mois, sur les 12 derniers mois</caption>
              <thead><tr><th scope="col">Mois</th><th scope="col">Encaissé</th><th scope="col">Attendu</th></tr></thead>
              <tbody>
                @for (h of s.historique; track h.periode) {
                  <tr><th scope="row">{{ h.periode | date: 'MMMM y' }}</th><td>{{ h.encaisse | currency: 'EUR' }}</td><td>{{ h.attendu | currency: 'EUR' }}</td></tr>
                }
              </tbody>
            </table>
          </figure>
        </section>
      }

      <div class="deux-colonnes">
        <section class="carte">
          <div class="ligne-titre">
            <h2>Impayés</h2>
            <a class="btn petit" routerLink="/loyers">Voir les loyers</a>
          </div>
          @if (impayes().length) {
            <ul class="liste" role="list">
              @for (e of impayes(); track e.id) {
                <li>
                  <a [routerLink]="['/baux', e.bail_id]">
                    <strong>{{ e.bien_libelle }}</strong>
                    <span class="muted">{{ e.locataires_noms }} · {{ e.periode | date: 'MMMM y' }}</span>
                    <span class="badge rouge">{{ reste(e) | currency: 'EUR' }}</span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <app-vide message="Aucun impayé. 🎉" />
          }
        </section>

        <section class="carte">
          <h2>À venir (90 jours)</h2>
          @if (alertes().length) {
            <ul class="liste" role="list">
              @for (a of alertes(); track a.texte) {
                <li><a [routerLink]="a.lien"><strong>{{ a.date | date: 'dd/MM/yyyy' }}</strong><span class="muted">{{ a.texte }}</span></a></li>
              }
            </ul>
          } @else {
            <app-vide message="Rien à signaler." />
          }
        </section>
      </div>

      <div class="raccourcis">
        <a class="btn" routerLink="/baux/nouveau"><app-icone nom="bail" /> Nouveau bail</a>
        <a class="btn" routerLink="/locataires/nouveau"><app-icone nom="locataire" /> Nouveau locataire</a>
        <a class="btn" routerLink="/biens/nouveau"><app-icone nom="bien" /> Nouveau bien</a>
      </div>
    }
  `,
})
export class TableauDeBord {
  private readonly bdd = inject(BaseDeDonnees);
  protected readonly jour = aujourdhui();
  protected readonly periode = periodeDe(this.jour);
  protected readonly annee = this.jour.slice(0, 4);

  private readonly donnees = resource({
    loader: async () => {
      const depot = this.bdd.depot;
      const [stats, impayes, baux] = await Promise.all([
        depot.statistiques.tableauDeBord(this.jour),
        depot.loyers.listerImpayes(this.jour),
        depot.baux.listerResumes({ statut: 'actif' }),
      ]);
      return { stats, impayes, baux };
    },
  });

  protected readonly stats = computed<Stats | null>(() => (this.donnees.hasValue() ? this.donnees.value().stats : null));
  protected readonly impayes = computed<EcheanceDetaillee[]>(() => (this.donnees.hasValue() ? this.donnees.value().impayes : []));
  protected readonly alertes = computed(() => (this.donnees.hasValue() ? this.calculerAlertes(this.donnees.value().baux) : []));

  private readonly maxHistorique = computed(() => Math.max(1, ...(this.stats()?.historique.map((h) => h.attendu) ?? [])));

  private calculerAlertes(baux: BailResume[]): Alerte[] {
    const horizon = ajouterJours(this.jour, 90);
    const alertes: Alerte[] = [];
    for (const b of baux) {
      const revision = prochaineDateRevision(b.date_debut, this.jour);
      if (revision <= horizon && b.irl_valeur_reference) {
        alertes.push({ date: revision, texte: `Révision IRL — ${b.bien_libelle}`, lien: ['/baux', b.id] });
      }
      const fin = dateFinContractuelle(b);
      if (fin >= this.jour && fin <= horizon) {
        alertes.push({
          date: fin,
          texte: `${b.tacite_reconduction ? 'Reconduction' : 'Fin'} du bail — ${b.bien_libelle}`,
          lien: ['/baux', b.id],
        });
      }
    }
    return alertes.sort((a, b) => a.date.localeCompare(b.date));
  }

  protected reste(e: EcheanceDetaillee) {
    return resteDu(e, e.total_paye);
  }

  protected hauteur(v: number) {
    return (v / this.maxHistorique()) * 100;
  }
}
