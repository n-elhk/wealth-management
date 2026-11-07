import { Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { FormField, form, hidden, submit, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { BienSaisieSchema, OPTIONS } from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Notifications } from '../../ui/notifications.service';
import { idRoute } from '../../ui/route';
import { AccessibiliteChamp, ErreurChamp, bool, nombre, sansVides, schemaModele, textes } from '../../ui/formulaire/saisie';

const CLES = [
  'libelle', 'type_bien', 'detenteur', 'societe_id', 'parent_id',
  'adresse_ligne1', 'adresse_ligne2', 'code_postal', 'ville', 'pays',
  'batiment', 'escalier', 'etage', 'porte', 'numero_lot', 'tantiemes', 'regime_juridique', 'lots_annexes', 'parties_communes',
  'surface_habitable', 'surface_terrain', 'annee_construction', 'nb_pieces', 'nb_chambres', 'equipements', 'description',
  'chauffage_mode', 'chauffage_energie', 'eau_chaude_mode', 'dpe_classe', 'dpe_consommation', 'ges_classe',
  'date_acquisition', 'prix_acquisition', 'taxe_fonciere', 'charges_copro_annuelles', 'notes',
] as const;
type ModeleBien = Record<(typeof CLES)[number], string> & { meuble: boolean };

const NUMERIQUES = [
  'societe_id', 'parent_id', 'tantiemes', 'surface_habitable', 'surface_terrain', 'annee_construction', 'nb_pieces',
  'nb_chambres', 'dpe_consommation', 'prix_acquisition', 'taxe_fonciere', 'charges_copro_annuelles',
] as const;

const SCHEMA = schemaModele(
  (m: ModeleBien) => ({
    ...sansVides(m),
    ...Object.fromEntries(NUMERIQUES.map((k) => [k, nombre(m[k])])),
    // La société n'est retenue que pour un bien détenu via une société.
    societe_id: m.detenteur === 'societe' ? nombre(m.societe_id) : null,
    meuble: bool(m.meuble),
  }),
  BienSaisieSchema,
);

@Component({
  selector: 'app-bien-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp, RouterLink],
  template: `
    <header class="entete">
      <div>
        <a class="retour" [routerLink]="id() ? ['/biens', id()] : '/biens'">← Retour</a>
        <h1>{{ id() ? 'Modifier le bien' : 'Nouveau bien' }}</h1>
      </div>
    </header>

    @if (pret()) {
      <form (submit)="enregistrer($event)" novalidate autocomplete="off">
        <fieldset class="carte">
          <legend>Général</legend>
          <div class="grille-champs">
            <label class="champ l4">
              <span>Nom du bien<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.libelle" placeholder="ex. T2 Croix-Rousse" />
              <app-erreur [champ]="f.libelle" />
            </label>
            <label class="champ l2">
              <span>Type<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.type_bien">
                @for (o of options.typeBien; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l3">
              <span>Détention<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.detenteur">
                @for (o of options.detenteur; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            @if (!f.societe_id().hidden()) {
              <label class="champ l3">
                <span>Société propriétaire<b class="requis">*</b></span>
                <select aria-required="true" [formField]="f.societe_id">
                  <option value="">—</option>
                  @for (s of societes(); track s.id) {
                    <option [value]="s.id">{{ s.raison_sociale }}</option>
                  }
                </select>
                @if (societes().length === 0) {
                  <small class="aide">Créez d’abord une société.</small>
                }
                <app-erreur [champ]="f.societe_id" />
              </label>
            }
            <label class="champ l3">
              <span>Rattaché à (immeuble…)</span>
              <select [formField]="f.parent_id">
                <option value="">—</option>
                @for (b of parents(); track b.id) {
                  <option [value]="b.id">{{ b.libelle }}</option>
                }
              </select>
            </label>
            <label class="champ case l3">
              <input type="checkbox" [formField]="f.meuble" />
              <span>Loué meublé</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Adresse</legend>
          <div class="grille-champs">
            <label class="champ l6">
              <span>Adresse<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.adresse_ligne1" />
              <app-erreur [champ]="f.adresse_ligne1" />
            </label>
            <label class="champ l6">
              <span>Complément d'adresse</span>
              <input [formField]="f.adresse_ligne2" />
            </label>
            <label class="champ l2">
              <span>Code postal<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.code_postal" />
              <app-erreur [champ]="f.code_postal" />
            </label>
            <label class="champ l2">
              <span>Ville<b class="requis">*</b></span>
              <input aria-required="true" [formField]="f.ville" />
              <app-erreur [champ]="f.ville" />
            </label>
            <label class="champ l2">
              <span>Pays</span>
              <input [formField]="f.pays" />
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Localisation dans l’immeuble</legend>
          <div class="grille-champs">
            <label class="champ l2"><span>Bâtiment</span><input [formField]="f.batiment" /></label>
            <label class="champ l2"><span>Escalier</span><input [formField]="f.escalier" /></label>
            <label class="champ l2"><span>Étage</span><input [formField]="f.etage" placeholder="RDC, 1, 2…" /></label>
            <label class="champ l2"><span>Porte</span><input [formField]="f.porte" /></label>
            <label class="champ l2"><span>N° de lot</span><input [formField]="f.numero_lot" /></label>
            <label class="champ l2">
              <span>Tantièmes</span>
              <div class="saisie" data-suffixe="/1000">
                <input type="text" inputmode="numeric" [formField]="f.tantiemes" />
              </div>
              <app-erreur [champ]="f.tantiemes" />
            </label>
            <label class="champ l3">
              <span>Régime juridique</span>
              <select [formField]="f.regime_juridique">
                <option value="">—</option>
                @for (o of options.regimeJuridique; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l3">
              <span>Lots annexes (cave, parking…)</span>
              <input [formField]="f.lots_annexes" placeholder="Cave n° 5, parking n° 12" />
            </label>
            <label class="champ l6">
              <span>Parties et équipements communs</span>
              <textarea rows="3" [formField]="f.parties_communes"></textarea>
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Caractéristiques</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Surface habitable</span>
              <div class="saisie" data-suffixe="m²">
                <input type="text" inputmode="decimal" [formField]="f.surface_habitable" />
              </div>
              <app-erreur [champ]="f.surface_habitable" />
            </label>
            <label class="champ l2">
              <span>Surface du terrain</span>
              <div class="saisie" data-suffixe="m²">
                <input type="text" inputmode="decimal" [formField]="f.surface_terrain" />
              </div>
              <app-erreur [champ]="f.surface_terrain" />
            </label>
            <label class="champ l2">
              <span>Année de construction</span>
              <input type="text" inputmode="numeric" [formField]="f.annee_construction" />
              <app-erreur [champ]="f.annee_construction" />
            </label>
            <label class="champ l2">
              <span>Pièces principales</span>
              <input type="text" inputmode="numeric" [formField]="f.nb_pieces" />
              <app-erreur [champ]="f.nb_pieces" />
            </label>
            <label class="champ l2">
              <span>Chambres</span>
              <input type="text" inputmode="numeric" [formField]="f.nb_chambres" />
              <app-erreur [champ]="f.nb_chambres" />
            </label>
            <label class="champ l6">
              <span>Équipements</span>
              <textarea rows="3" [formField]="f.equipements" placeholder="Cuisine équipée, interphone, fibre…"></textarea>
            </label>
            <label class="champ l6">
              <span>Description</span>
              <textarea rows="3" [formField]="f.description"></textarea>
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Énergie</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Chauffage</span>
              <select [formField]="f.chauffage_mode">
                <option value="">—</option>
                @for (o of options.modeChauffage; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Énergie de chauffage</span>
              <input [formField]="f.chauffage_energie" placeholder="Gaz, électricité…" />
            </label>
            <label class="champ l2">
              <span>Eau chaude</span>
              <select [formField]="f.eau_chaude_mode">
                <option value="">—</option>
                @for (o of options.modeChauffage; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Classe DPE</span>
              <select [formField]="f.dpe_classe">
                <option value="">—</option>
                @for (o of options.classeEnergie; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Consommation</span>
              <div class="saisie" data-suffixe="kWh/m²/an">
                <input type="text" inputmode="decimal" [formField]="f.dpe_consommation" />
              </div>
              <app-erreur [champ]="f.dpe_consommation" />
            </label>
            <label class="champ l2">
              <span>Classe GES</span>
              <select [formField]="f.ges_classe">
                <option value="">—</option>
                @for (o of options.classeEnergie; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Acquisition & charges</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Date d’acquisition</span>
              <input type="date" [formField]="f.date_acquisition" />
              <app-erreur [champ]="f.date_acquisition" />
            </label>
            <label class="champ l2">
              <span>Prix d’acquisition</span>
              <div class="saisie" data-suffixe="€">
                <input type="text" inputmode="decimal" [formField]="f.prix_acquisition" />
              </div>
              <app-erreur [champ]="f.prix_acquisition" />
            </label>
            <label class="champ l2">
              <span>Taxe foncière annuelle</span>
              <div class="saisie" data-suffixe="€">
                <input type="text" inputmode="decimal" [formField]="f.taxe_fonciere" />
              </div>
              <app-erreur [champ]="f.taxe_fonciere" />
            </label>
            <label class="champ l3">
              <span>Charges de copropriété annuelles</span>
              <div class="saisie" data-suffixe="€">
                <input type="text" inputmode="decimal" [formField]="f.charges_copro_annuelles" />
              </div>
              <app-erreur [champ]="f.charges_copro_annuelles" />
            </label>
            <label class="champ l6">
              <span>Notes</span>
              <textarea rows="3" [formField]="f.notes"></textarea>
            </label>
          </div>
        </fieldset>

        <div class="actions-formulaire">
          <button type="button" class="btn" (click)="retour()">Annuler</button>
          <button type="submit" class="btn primaire" [disabled]="f().submitting()">Enregistrer</button>
        </div>
      </form>
    } @else if (bien.error()) {
      <p class="alerte">Bien introuvable.</p>
    } @else if (listes.error()) {
      <p class="alerte">Impossible de charger les sociétés et biens.</p>
    }
  `,
})
export class BienForm {
  readonly id = input(null, { transform: idRoute });
  /** Pré-sélection depuis la fiche société (`?societe=ID`). */
  readonly societe = input(null, { transform: idRoute });

  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected readonly options = OPTIONS;

  /** Listes de choix (sociétés, biens parents), nécessaires en création comme en modification. */
  protected readonly listes = resource({
    loader: async () => {
      const depot = this.bdd.depot;
      const [societes, biens] = await Promise.all([depot.societes.lister(), depot.biens.lister()]);
      return { societes, biens };
    },
  });
  /** Bien modifié ; sans id (création), la resource reste inactive et le loader n'est pas appelé. */
  protected readonly bien = resource({
    params: () => this.id() ?? undefined,
    loader: ({ params: id }) => this.bdd.depot.biens.exiger(id),
  });
  /** Formulaire affiché une fois les listes chargées (et le bien, en modification). */
  protected readonly pret = computed(() => this.listes.hasValue() && (!this.id() || this.bien.hasValue()));

  protected readonly societes = computed(() => (this.listes.hasValue() ? this.listes.value().societes : []));
  /** Biens auxquels rattacher celui-ci : ni lui-même ni ses descendants, pour éviter un cycle. */
  protected readonly parents = computed(() => {
    if (!this.listes.hasValue()) return [];
    const biens = this.listes.value().biens;
    const id = this.id();
    if (!id) return biens;
    const exclus = new Set([id]);
    let ajout = true;
    while (ajout) {
      ajout = false;
      for (const b of biens) {
        if (b.parent_id !== null && exclus.has(b.parent_id) && !exclus.has(b.id)) {
          exclus.add(b.id);
          ajout = true;
        }
      }
    }
    return biens.filter((b) => !exclus.has(b.id));
  });

  /** Modèle initialisé avec le bien chargé, ou des valeurs par défaut pour un nouveau bien. */
  protected readonly modele = linkedSignal<ModeleBien>(() => {
    const bien = this.bien.hasValue() ? this.bien.value() : null;
    if (bien) return { ...textes(CLES, bien), meuble: !!bien.meuble };
    const societe = this.societe();
    return {
      ...textes(CLES, {
        type_bien: 'appartement',
        detenteur: societe ? 'societe' : 'personnel',
        societe_id: societe,
        pays: 'France',
      }),
      meuble: false,
    };
  });

  protected readonly f = form(this.modele, (p) => {
    hidden(p.societe_id, { when: ({ valueOf }) => valueOf(p.detenteur) !== 'societe' });
    validateStandardSchema(p, SCHEMA.validation);
  });

  protected enregistrer(event: Event) {
    event.preventDefault();
    submit(this.f, async () => {
      try {
        const v = SCHEMA.parse(this.modele());
        const repo = this.bdd.depot.biens;
        let id = this.id();
        if (id) await repo.modifier(id, v);
        else id = await repo.creer(v);
        this.notifications.succes('Bien enregistré');
        await this.router.navigate(['/biens', id]);
      } catch (e) {
        this.notifications.erreur(e);
      }
    });
  }

  protected retour() {
    const id = this.id();
    this.router.navigate(id ? ['/biens', id] : ['/biens']);
  }
}
