import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  LIBELLES_MODE_PAIEMENT,
  LIBELLES_ROLE_LOCATAIRE,
  LIBELLES_TYPE_BAIL,
  LIBELLES_TYPE_GARANT,
  arrondi,
  aujourdhui,
  dateFinContractuelle,
  genererAvisEcheance,
  genererContratBail,
  genererQuittance,
  nomComplet,
  prochaineDateRevision,
  resteDu,
  statutEcheance,
  totalEcheance,
  type Garant,
  type Paiement,
} from '@wealth-management/core';
import type { EcheanceSuivi } from '@wealth-management/db';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Documents, nomFichier } from '../../infrastructure/documents.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Notifications } from '../../ui/notifications.service';
import { Fiche } from '../../ui/fiche/fiche.component';
import { idRoute } from '../../ui/route';
import { Icone } from '../../ui/icone';
import { BadgeStatutBail } from './statut-bail';
import { BadgeStatutEcheance } from '../../loyers/statut-echeance';
import { Vide } from '../../ui/vide';
import { champsBail } from './bail.champs';
import { FinBailForm } from './fin-bail-form';
import { GarantForm } from './garant-form';
import { PaiementForm } from '../../loyers/paiement-form';
import { RevisionForm } from '../../loyers/revision-form';

type Panneau = 'fin' | 'revision' | 'garant' | null;

@Component({
  selector: 'app-bail-detail',
  imports: [RouterLink, Fiche, FinBailForm, GarantForm, PaiementForm, RevisionForm, Icone, BadgeStatutBail, BadgeStatutEcheance, Vide, CurrencyPipe, DatePipe, LibellePipe],
  styleUrl: './bail-detail.css',
  template: `
    @if (donnees(); as d) {
      <header class="entete">
        <div>
          <a class="retour" routerLink="/baux">← Baux</a>
          <h1>{{ d.bien.libelle }} <app-statut-bail [statut]="d.bail.statut" /></h1>
          <p class="muted">{{ d.bail.type_bail | libelle: typesBail }}@if (d.bail.reference) { · {{ d.bail.reference }} }</p>
        </div>
        <div class="actions">
          <button class="btn primaire" (click)="contrat()"><app-icone nom="pdf" /> Contrat PDF</button>
          @if (d.bail.statut === 'brouillon') {
            <button class="btn" (click)="activer()"><app-icone nom="check" /> Activer</button>
          }
          @if (d.bail.statut === 'actif') {
            <button class="btn" (click)="panneau.set('fin')" [attr.aria-expanded]="panneau() === 'fin'" aria-controls="panneau-bail">Terminer</button>
            <button class="btn" (click)="panneau.set('revision')" [attr.aria-expanded]="panneau() === 'revision'" aria-controls="panneau-bail">Réviser le loyer</button>
          }
          <a class="btn" [routerLink]="['/baux', d.bail.id, 'modifier']" aria-label="Modifier le bail" title="Modifier le bail"><app-icone nom="modifier" /></a>
          <button class="btn danger" (click)="supprimer()" aria-label="Supprimer le bail" title="Supprimer le bail"><app-icone nom="supprimer" /></button>
        </div>
      </header>

      <div class="kpis">
        <div class="kpi"><span>Loyer charges comprises</span><strong>{{ d.bail.loyer_hc + d.bail.charges | currency: 'EUR' }}</strong><small>{{ d.bail.loyer_hc | currency: 'EUR' }} + {{ d.bail.charges | currency: 'EUR' }}</small></div>
        <div class="kpi"><span>Période</span><strong>{{ d.bail.date_debut | date: 'dd/MM/yyyy' }}</strong><small>@if (d.bail.date_sortie) { sortie le {{ d.bail.date_sortie | date: 'dd/MM/yyyy' }} } @else { échéance {{ finContractuelle() | date: 'dd/MM/yyyy' }} }</small></div>
        <div class="kpi" [class.alerte-kpi]="solde() > 0"><span>Reste dû</span><strong>{{ solde() | currency: 'EUR' }}</strong><small>{{ nbImpayes() }} échéance(s) non soldée(s)</small></div>
        <div class="kpi"><span>Dépôt de garantie</span><strong>{{ d.bail.depot_garantie | currency: 'EUR' }}</strong>@if (d.bail.statut === 'actif') {<small>révision le {{ prochaineRevision() | date: 'dd/MM/yyyy' }}</small>}</div>
      </div>

      @switch (panneau()) {
        @case ('fin') {
          <section class="carte" id="panneau-bail">
            <h2>Fin du bail</h2>
            <p class="muted">Les échéances non payées postérieures à la sortie seront supprimées et le dernier mois proratisé.</p>
            <app-fin-bail-form [bail]="d.bail" (enregistre)="apresModification()" (annule)="panneau.set(null)" />
          </section>
        }
        @case ('revision') {
          <section class="carte" id="panneau-bail">
            <h2>Révision annuelle du loyer (IRL)</h2>
            <p class="muted">
              IRL de référence actuel : {{ d.bail.irl_valeur_reference ?? 'non renseigné' }}
              @if (d.bail.irl_trimestre_reference) { ({{ d.bail.irl_trimestre_reference }}) }.
              Le nouveau loyer est calculé automatiquement : loyer × nouvel IRL ÷ IRL de référence.
            </p>
            <app-revision-form [bail]="d.bail" (enregistre)="apresModification()" (annule)="panneau.set(null)" />
          </section>
        }
      }

      <div class="deux-colonnes">
        <section class="carte">
          <h2>Locataire(s)</h2>
          @if (d.locataires.length) {
            <ul class="liste" role="list">
              @for (l of d.locataires; track l.id) {
                <li>
                  <a [routerLink]="['/locataires', l.id]">
                    <strong>{{ nom(l) }}</strong>
                    <span class="muted">{{ l.role | libelle: roles }}</span>
                    <span class="muted">{{ l.telephone || l.email }}</span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <p class="muted">Aucun locataire.</p>
          }
          <p class="muted">Bien : <a [routerLink]="['/biens', d.bien.id]">{{ d.bien.libelle }}</a></p>
        </section>

        <section class="carte">
          <div class="ligne-titre">
            <h2>Garants</h2>
            <button class="btn petit" (click)="panneau.set(panneau() === 'garant' ? null : 'garant')" [attr.aria-expanded]="panneau() === 'garant'" aria-controls="ajout-garant"><app-icone nom="plus" /> Garant</button>
          </div>
          @if (panneau() === 'garant') {
            <app-garant-form id="ajout-garant" [bailId]="d.bail.id" (enregistre)="apresModification()" (annule)="panneau.set(null)" />
          }
          @if (d.garants.length) {
            <ul class="liste" role="list">
              @for (g of d.garants; track g.id) {
                <li>
                  <div>
                    <strong>{{ nom(g) }}</strong>
                    <span class="muted">{{ g.type_garant | libelle: typesGarant }}@if (g.montant_engagement) { · jusqu’à {{ g.montant_engagement | currency: 'EUR' }} }</span>
                  </div>
                  <button class="btn lien-danger" (click)="supprimerGarant(g)" [attr.aria-label]="'Retirer ' + nom(g)">Retirer</button>
                </li>
              }
            </ul>
          } @else if (panneau() !== 'garant') {
            <p class="muted">Aucun garant.</p>
          }
        </section>
      </div>

      <section class="carte">
        <h2>Échéancier & paiements</h2>
        @if (echeances().length === 0) {
          <app-vide [message]="d.bail.statut === 'brouillon' ? 'Activez le bail pour générer les échéances.' : 'Aucune échéance pour le moment.'" />
        } @else {
          <div class="tableau" tabindex="0" role="region" aria-label="Échéancier et paiements">
            <table>
              <thead>
                <tr><th>Période</th><th>Échéance</th><th class="num">Dû</th><th class="num">Payé</th><th>Statut</th><th class="num">Actions</th></tr>
              </thead>
              <tbody>
                @for (e of echeances(); track e.id) {
                  <tr [class.ouverte]="ouverte() === e.id">
                    <td><button class="btn lien" (click)="basculer(e)" [attr.aria-expanded]="ouverte() === e.id" [attr.aria-controls]="'detail-' + e.id">{{ e.periode | date: 'MMMM y' }}</button></td>
                    <td>{{ e.date_echeance | date: 'dd/MM/yyyy' }}</td>
                    <td class="num">{{ total(e) | currency: 'EUR' }}</td>
                    <td class="num">{{ e.total_paye | currency: 'EUR' }}</td>
                    <td><app-statut-echeance [statut]="statut(e)" /></td>
                    <td class="num actions-ligne">
                      @if (reste(e) > 0) {
                        <button class="btn petit primaire" (click)="solder(e)" title="Enregistrer le paiement du reste dû" [attr.aria-label]="'Encaisser ' + (e.periode | date: 'MMMM y')">Encaisser</button>
                        <button class="btn petit" (click)="saisirPaiement(e)" title="Paiement partiel ou autre montant" [attr.aria-label]="'Paiement partiel ou autre montant, ' + (e.periode | date: 'MMMM y')" [attr.aria-expanded]="paiementPour() === e.id" [attr.aria-controls]="'paiement-' + e.id">+</button>
                      }
                      @if (e.total_paye > 0) {
                        <button class="btn petit" (click)="quittance(e)" title="Quittance / reçu" [attr.aria-label]="'Quittance ' + (e.periode | date: 'MMMM y')"><app-icone nom="pdf" [taille]="16" /> Quittance</button>
                      } @else {
                        <button class="btn petit" (click)="avis(e)" title="Avis d’échéance" [attr.aria-label]="'Avis ' + (e.periode | date: 'MMMM y')"><app-icone nom="pdf" [taille]="16" /> Avis</button>
                      }
                    </td>
                  </tr>
                  @if (paiementPour() === e.id) {
                    <tr class="sous-ligne" [id]="'paiement-' + e.id">
                      <td colspan="6">
                        <app-paiement-form [echeance]="e" [modeParDefaut]="d.bail.mode_paiement" (enregistre)="paiementAjoute()" (annule)="paiementPour.set(null)" />
                      </td>
                    </tr>
                  }
                  @if (ouverte() === e.id) {
                    <tr class="sous-ligne" [id]="'detail-' + e.id">
                      <td colspan="6">
                        <p class="muted">Du {{ e.date_debut_periode | date: 'dd/MM/yyyy' }} au {{ e.date_fin_periode | date: 'dd/MM/yyyy' }} — loyer {{ e.loyer | currency: 'EUR' }}, charges {{ e.charges | currency: 'EUR' }}</p>
                        @for (p of paiements(); track p.id) {
                          <div class="paiement">
                            <span>{{ p.date_paiement | date: 'dd/MM/yyyy' }}</span>
                            <strong>{{ p.montant | currency: 'EUR' }}</strong>
                            <span class="muted">{{ p.mode | libelle: modes }} {{ p.reference }}</span>
                            <button class="btn lien-danger" (click)="supprimerPaiement(e, p)" [attr.aria-label]="'Supprimer le paiement du ' + (p.date_paiement | date: 'dd/MM/yyyy')">Supprimer</button>
                          </div>
                        } @empty {
                          <p class="muted">Aucun paiement enregistré.</p>
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      @if (d.revisions.length) {
        <section class="carte">
          <h2>Historique des révisions</h2>
          <ul class="liste" role="list">
            @for (r of d.revisions; track r.id) {
              <li><div><strong>{{ r.date_effet | date: 'dd/MM/yyyy' }}</strong> : {{ r.ancien_loyer | currency: 'EUR' }} → {{ r.nouveau_loyer | currency: 'EUR' }}
                <span class="muted">@if (r.irl_trimestre) { IRL {{ r.irl_trimestre }} } @if (r.irl_nouveau) { ({{ r.irl_ancien }} → {{ r.irl_nouveau }}) }</span></div></li>
            }
          </ul>
        </section>
      }

      <app-fiche [champs]="champsBail" [valeur]="$any(d.bail)" />
    } @else if (chargement.error()) {
      <p class="alerte">Bail introuvable.</p>
    }
  `,
})
export class BailDetail {
  readonly id = input(null, { transform: idRoute });
  private readonly bdd = inject(BaseDeDonnees);
  private readonly documents = inject(Documents);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);

  protected readonly jour = aujourdhui();
  protected readonly typesBail = LIBELLES_TYPE_BAIL;
  protected readonly typesGarant = LIBELLES_TYPE_GARANT;
  protected readonly roles = LIBELLES_ROLE_LOCATAIRE;
  protected readonly modes = LIBELLES_MODE_PAIEMENT;
  protected readonly champsBail = champsBail([]).filter((c) => c.cle !== 'bien_id');

  /** Bail complet, échéances (resynchronisées à chaque chargement) et identité du bailleur pour les documents. */
  protected readonly chargement = resource({
    params: () => this.id() ?? undefined,
    loader: async ({ params: id }) => {
      const depot = this.bdd.depot;
      const complet = await depot.baux.obtenirComplet(id);
      if (!complet) throw new Error('Bail introuvable');
      await depot.loyers.synchroniser(complet.bail, this.jour);
      const [echeances, profil, societe] = await Promise.all([
        depot.loyers.listerParBail(id),
        depot.profil.obtenir(),
        complet.bien.societe_id ? depot.societes.obtenir(complet.bien.societe_id) : null,
      ]);
      return { complet, echeances, bailleur: { profil, societe } };
    },
  });

  protected readonly ouverte = signal<number | null>(null);
  /** Paiements de l'échéance dépliée. */
  private readonly paiementsOuverte = resource({
    params: () => this.ouverte() ?? undefined,
    loader: ({ params: echeanceId }) => this.bdd.depot.loyers.listerPaiements(echeanceId),
  });
  protected readonly paiementPour = signal<number | null>(null);
  protected readonly panneau = signal<Panneau>(null);

  protected readonly donnees = computed(() => (this.chargement.hasValue() ? this.chargement.value().complet : null));
  protected readonly echeances = computed(() => (this.chargement.hasValue() ? this.chargement.value().echeances : []));
  protected readonly paiements = computed(() => (this.paiementsOuverte.hasValue() ? this.paiementsOuverte.value() : []));
  private readonly bailleur = computed(() =>
    this.chargement.hasValue() ? this.chargement.value().bailleur : { profil: null, societe: null },
  );

  protected readonly finContractuelle = computed(() => {
    const d = this.donnees();
    return d ? dateFinContractuelle(d.bail) : null;
  });
  protected readonly prochaineRevision = computed(() => {
    const d = this.donnees();
    return d ? prochaineDateRevision(d.bail.date_debut, this.jour) : null;
  });
  private readonly exigibles = computed(() =>
    this.echeances().filter((e) => e.date_echeance <= this.jour && arrondi(e.total_paye) < totalEcheance(e)),
  );
  protected readonly solde = computed(() => arrondi(this.exigibles().reduce((t, e) => t + totalEcheance(e) - e.total_paye, 0)));
  protected readonly nbImpayes = computed(() => this.exigibles().length);

  /** Recharge le bail et ses échéances après une modification (et ferme le panneau ouvert). */
  protected apresModification() {
    this.panneau.set(null);
    this.chargement.reload();
  }

  private rafraichirEcheances() {
    this.chargement.reload();
    this.paiementsOuverte.reload();
  }

  protected nom(p: { civilite?: string | null; prenom?: string | null; nom?: string | null }) {
    return nomComplet(p, true);
  }

  protected total(e: EcheanceSuivi) {
    return totalEcheance(e);
  }

  protected reste(e: EcheanceSuivi) {
    return resteDu(e, e.total_paye);
  }

  protected statut(e: EcheanceSuivi) {
    return statutEcheance(e, e.total_paye, this.jour);
  }

  // --- Échéances & paiements ------------------------------------------------

  protected basculer(e: EcheanceSuivi) {
    this.ouverte.update((id) => (id === e.id ? null : e.id));
  }

  protected saisirPaiement(e: EcheanceSuivi) {
    this.paiementPour.set(this.paiementPour() === e.id ? null : e.id);
  }

  protected async solder(e: EcheanceSuivi) {
    try {
      const id = await this.bdd.depot.loyers.solder(e.id, this.jour);
      if (id === null) this.notifications.info(`L’échéance ${e.periode} est déjà soldée`);
      else this.notifications.succes(`Paiement de ${e.periode} enregistré`);
      this.rafraichirEcheances();
    } catch (err) {
      this.notifications.erreur(err);
    }
  }

  protected paiementAjoute() {
    this.paiementPour.set(null);
    this.rafraichirEcheances();
  }

  protected async supprimerPaiement(_e: EcheanceSuivi, p: Paiement) {
    if (!(await this.notifications.confirmer('Supprimer ce paiement ?'))) return;
    try {
      await this.bdd.depot.loyers.paiements.supprimer(p.id);
      this.notifications.succes('Paiement supprimé');
    } catch (err) {
      this.notifications.erreur(err);
    }
    this.rafraichirEcheances();
  }

  // --- Documents ------------------------------------------------------------

  protected async contrat() {
    const d = this.donnees()!;
    await this.documents.pdf(
      genererContratBail({ ...d, ...this.bailleur() }),
      nomFichier('Bail', d.bien.libelle, d.locataires[0]?.nom, d.bail.date_debut),
    );
  }

  private async contexteEcheance(e: EcheanceSuivi) {
    const d = this.donnees()!;
    const paiements = await this.bdd.depot.loyers.listerPaiements(e.id);
    return { ...d, ...this.bailleur(), echeance: e, paiements, dateEmission: this.jour };
  }

  protected async quittance(e: EcheanceSuivi) {
    const ctx = await this.contexteEcheance(e);
    const type = this.reste(e) <= 0 ? 'Quittance' : 'Recu_partiel';
    await this.documents.pdf(genererQuittance(ctx), nomFichier(type, ctx.bien.libelle, e.periode));
  }

  protected async avis(e: EcheanceSuivi) {
    const ctx = await this.contexteEcheance(e);
    await this.documents.pdf(genererAvisEcheance(ctx), nomFichier('Avis_echeance', ctx.bien.libelle, e.periode));
  }

  // --- Cycle de vie du bail ---------------------------------------------------

  protected async activer() {
    const d = this.donnees()!;
    try {
      if (d.locataires.length === 0) throw new Error('Ajoutez au moins un locataire avant d’activer le bail.');
      await this.bdd.depot.baux.verifierChevauchement({ ...d.bail, statut: 'actif' });
      await this.bdd.depot.baux.modifier(d.bail.id, { statut: 'actif' });
      this.notifications.succes('Bail activé');
      this.chargement.reload();
    } catch (e) {
      this.notifications.erreur(e);
    }
  }

  // --- Garants & suppression --------------------------------------------------

  protected async supprimerGarant(g: Garant) {
    if (!(await this.notifications.confirmer(`Retirer le garant ${this.nom(g)} ?`))) return;
    try {
      await this.bdd.depot.baux.garants.supprimer(g.id);
      this.notifications.succes('Garant retiré');
    } catch (err) {
      this.notifications.erreur(err);
    }
    this.chargement.reload();
  }

  protected async supprimer() {
    const d = this.donnees()!;
    const msg =
      d.bail.statut === 'brouillon'
        ? 'Supprimer ce brouillon de bail ?'
        : 'Supprimer ce bail ainsi que TOUTES ses échéances et paiements ? L’historique sera perdu. Pour un départ de locataire, utilisez plutôt « Terminer ».';
    if (!(await this.notifications.confirmer(msg, 'Suppression du bail'))) return;
    try {
      await this.bdd.depot.baux.supprimer(d.bail.id);
      this.notifications.succes('Bail supprimé');
      this.router.navigate(['/baux']);
    } catch (e) {
      this.notifications.erreur(e);
    }
  }
}
