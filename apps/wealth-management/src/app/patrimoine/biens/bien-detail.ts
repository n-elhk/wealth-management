import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LIBELLES_TYPE_BAIL, formatAdresse, localisationBien } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { LibellePipe } from '../../ui/formats.pipe';
import { Notifications } from '../../ui/notifications.service';
import { Fiche } from '../../ui/fiche/fiche.component';
import { idRoute } from '../../ui/route';
import { Icone } from '../../ui/icone';
import { BadgeStatutBail } from '../../location/baux/statut-bail';
import { Vide } from '../../ui/vide';
import { LigneCliquable } from '../../ui/ligne-cliquable';
import { champsBien } from './bien.champs';

@Component({
  selector: 'app-bien-detail',
  imports: [RouterLink, LigneCliquable, Fiche, Icone, BadgeStatutBail, Vide, CurrencyPipe, DatePipe, LibellePipe],
  template: `
    @if (bien(); as b) {
      <header class="entete">
        <div>
          <a class="retour" routerLink="/biens">← Biens</a>
          <h1>{{ b.libelle }}</h1>
          <p class="muted">{{ adresse() }}@if (localisation()) { — {{ localisation() }} }</p>
        </div>
        <div class="actions">
          <a class="btn" [routerLink]="['/biens', b.id, 'modifier']"><app-icone nom="modifier" /> Modifier</a>
          <button class="btn danger" (click)="supprimer()" aria-label="Supprimer le bien" title="Supprimer le bien"><app-icone nom="supprimer" /></button>
        </div>
      </header>

      <section class="carte">
        <div class="ligne-titre">
          <h2>Propriétaire</h2>
        </div>
        @if (societe(); as s) {
          <p><a [routerLink]="['/societes', s.id]">{{ s.raison_sociale }}</a> <span class="muted">({{ s.forme_juridique }})</span></p>
        } @else {
          <p>Détenu en nom propre</p>
        }
      </section>

      <section class="carte">
        <div class="ligne-titre">
          <h2>Historique des locations</h2>
          <a class="btn petit primaire" routerLink="/baux/nouveau" [queryParams]="{ bien: b.id }"><app-icone nom="plus" /> Nouveau bail</a>
        </div>
        @if (baux().length) {
          <div class="tableau" tabindex="0" role="region" aria-label="Historique des locations">
            <table>
              <thead><tr><th>Locataire(s)</th><th>Type</th><th>Début</th><th>Sortie</th><th class="num">Loyer CC</th><th>Statut</th></tr></thead>
              <tbody>
                @for (x of baux(); track x.id) {
                  <tr appLigneCliquable>
                    <td><a [routerLink]="['/baux', x.id]">{{ x.locataires_noms || 'Bail sans locataire' }}</a></td>
                    <td>{{ x.type_bail | libelle: typesBail }}</td>
                    <td>{{ x.date_debut | date: 'dd/MM/yyyy' }}</td>
                    <td>{{ x.date_sortie | date: 'dd/MM/yyyy' }}</td>
                    <td class="num">{{ x.loyer_hc + x.charges | currency: 'EUR' }}</td>
                    <td><app-statut-bail [statut]="x.statut" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <app-vide message="Ce bien n’a encore jamais été loué." />
        }
      </section>

      <app-fiche [champs]="champs()" [valeur]="$any(b)" />
    } @else if (donnees.error()) {
      <p class="alerte">Bien introuvable.</p>
    }
  `,
})
export class BienDetail {
  readonly id = input(null, { transform: idRoute });
  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected readonly typesBail = LIBELLES_TYPE_BAIL;

  protected readonly donnees = resource({
    params: () => this.id() ?? undefined,
    loader: async ({ params: id }) => {
      const depot = this.bdd.depot;
      const [bien, baux, biens] = await Promise.all([
        depot.biens.exiger(id),
        depot.baux.listerResumes({ bienId: id }),
        depot.biens.lister(),
      ]);
      const societe = bien.societe_id ? await depot.societes.obtenir(bien.societe_id) : null;
      return { bien, baux, biens, societe };
    },
  });

  protected readonly bien = computed(() => (this.donnees.hasValue() ? this.donnees.value().bien : null));
  protected readonly societe = computed(() => (this.donnees.hasValue() ? this.donnees.value().societe : null));
  protected readonly baux = computed(() => (this.donnees.hasValue() ? this.donnees.value().baux : []));
  protected readonly adresse = computed(() => {
    const b = this.bien();
    return b ? formatAdresse(b) : '';
  });
  protected readonly localisation = computed(() => {
    const b = this.bien();
    return b ? localisationBien(b) : '';
  });
  /** Les champs de détention et d'adresse sont affichés dans l'en-tête et la carte « Propriétaire ». */
  protected readonly champs = computed(() => {
    const biens = this.donnees.hasValue() ? this.donnees.value().biens : [];
    return champsBien(biens.map((b) => ({ value: b.id, label: b.libelle }))).filter(
      (c) => !['libelle', 'detenteur', 'societe_id', 'adresse_ligne1', 'adresse_ligne2', 'code_postal', 'ville', 'pays'].includes(c.cle),
    );
  });

  async supprimer() {
    const b = this.bien();
    if (!b || !(await this.notifications.confirmer(`Supprimer définitivement « ${b.libelle} » ?`))) return;
    try {
      await this.bdd.depot.biens.supprimer(b.id);
      this.notifications.succes('Bien supprimé');
      this.router.navigate(['/biens']);
    } catch (e) {
      this.notifications.erreur(e);
    }
  }
}
