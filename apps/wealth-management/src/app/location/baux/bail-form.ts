import { Component, computed, inject, input, linkedSignal, resource, signal } from '@angular/core';
import { FormField, form, hidden, submit, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import {
  BailSaisieSchema,
  DUREE_DEFAUT_BAIL,
  OPTIONS,
  aujourdhui,
  depotGarantieMaximum,
  formatEuro,
  nomComplet,
  periodeDe,
  type Bail,
  type Locataire,
  type Periode,
  type RoleLocataire,
  type TypeBail,
} from '@wealth-management/core';
import { BaseDeDonnees } from '../../infrastructure/base-de-donnees.service';
import { Brouillons } from '../../infrastructure/brouillons.service';
import { Notifications } from '../../ui/notifications.service';
import { idRoute } from '../../ui/route';
import { AccessibiliteChamp, ErreurChamp, bool, nombre, sansVides, schemaModele, textes } from '../../ui/formulaire/saisie';
import { Icone } from '../../ui/icone';

/** Champs dont la modification impose de recalculer les échéances non payées. */
const CHAMPS_ECHEANCES: (keyof Bail)[] = [
  'date_debut', 'duree_mois', 'tacite_reconduction', 'date_sortie', 'loyer_hc', 'charges', 'jour_paiement', 'paiement_terme', 'statut',
];

const CLES = [
  'bien_id', 'type_bail', 'reference', 'statut', 'date_signature', 'date_debut', 'duree_mois', 'destination',
  'date_sortie', 'motif_sortie', 'loyer_hc', 'charges', 'mode_charges', 'depot_garantie',
  'jour_paiement', 'paiement_terme', 'mode_paiement',
  'irl_trimestre_reference', 'irl_valeur_reference', 'loyer_reference_majore', 'complement_loyer', 'dernier_loyer_precedent',
  'clauses_particulieres', 'notes',
] as const;
type ModeleBail = Record<(typeof CLES)[number], string> & { tacite_reconduction: boolean; zone_tendue: boolean };

const NUMERIQUES = [
  'bien_id', 'duree_mois', 'loyer_hc', 'charges', 'depot_garantie', 'jour_paiement',
  'irl_valeur_reference', 'loyer_reference_majore', 'complement_loyer', 'dernier_loyer_precedent',
] as const;

const TYPES_HABITATION: readonly string[] = ['habitation_vide', 'habitation_meuble', 'etudiant', 'mobilite'];
const estHabitation = (m: ModeleBail) => TYPES_HABITATION.includes(m.type_bail);
const encadre = (m: ModeleBail) => estHabitation(m) && m.zone_tendue;

/** Conversion du modèle : les champs masqués sont enregistrés vides. */
const SCHEMA = schemaModele((m: ModeleBail) => {
  const s = {
    ...sansVides(m),
    ...Object.fromEntries(NUMERIQUES.map((k) => [k, nombre(m[k])])),
    tacite_reconduction: bool(m.tacite_reconduction),
    zone_tendue: bool(estHabitation(m) && m.zone_tendue),
  };
  if (m.statut !== 'termine') Object.assign(s, { date_sortie: null, motif_sortie: null });
  if (!estHabitation(m)) Object.assign(s, { irl_trimestre_reference: null, irl_valeur_reference: null });
  if (!encadre(m)) Object.assign(s, { loyer_reference_majore: null, complement_loyer: null, dernier_loyer_precedent: null });
  return s;
}, BailSaisieSchema);

interface ChoixLocataire {
  locataire_id: number;
  nom: string;
  coche: boolean;
  role: RoleLocataire;
}

/** Saisie conservée pendant la création d'un locataire depuis le formulaire. */
interface BrouillonBail {
  modele: ModeleBail;
  roles: [number, RoleLocataire][];
}

@Component({
  selector: 'app-bail-form',
  imports: [FormField, AccessibiliteChamp, ErreurChamp, RouterLink, Icone],
  styleUrl: './bail-form.css',
  template: `
    <header class="entete">
      <div>
        <a class="retour" [routerLink]="id() ? ['/baux', id()] : '/baux'">← Retour</a>
        <h1>{{ id() ? 'Modifier le bail' : 'Nouveau bail' }}</h1>
      </div>
    </header>

    @if (pret()) {
      <form (submit)="enregistrer($event)" novalidate autocomplete="off">
        <fieldset class="carte">
          <legend>Locataire(s)</legend>
          @if (fChoix.length === 0) {
            <p class="muted">Aucun locataire enregistré.</p>
          }
          <div class="selection-locataires">
            @for (c of fChoix; track c.locataire_id().value(); let i = $index) {
              <div class="choix" [class.coche]="c.coche().value()">
                <label>
                  <input type="checkbox" [formField]="c.coche" (change)="surCoche(i, $any($event.target).checked)" />
                  {{ c.nom().value() }}
                </label>
                @if (c.coche().value()) {
                  <select [formField]="c.role">
                    <option value="titulaire">Titulaire</option>
                    <option value="colocataire">Colocataire</option>
                  </select>
                }
              </div>
            }
          </div>
          <button type="button" class="btn petit" (click)="nouveauLocataire()">
            <app-icone nom="plus" /> Nouveau locataire
          </button>
          @if (erreurLocataires(); as erreur) {
            <p class="erreur" role="alert">{{ erreur }}</p>
          }
        </fieldset>

        <fieldset class="carte">
          <legend>Bail</legend>
          <div class="grille-champs">
            <label class="champ l3">
              <span>Bien loué<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.bien_id">
                <option value="">—</option>
                @for (b of biens(); track b.id) {
                  <option [value]="b.id">{{ b.libelle }}</option>
                }
              </select>
              <app-erreur [champ]="f.bien_id" />
            </label>
            <label class="champ l3">
              <span>Type de bail<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.type_bail" (change)="appliquerDefautsType($any($event.target).value)">
                @for (o of options.typeBail; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Référence</span>
              <input [formField]="f.reference" placeholder="ex. 2025-T2-LYON" />
            </label>
            <label class="champ l2">
              <span>Statut<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.statut">
                @for (o of options.statutBail; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Date de signature</span>
              <input type="date" [formField]="f.date_signature" />
              <app-erreur [champ]="f.date_signature" />
            </label>
            <label class="champ l2">
              <span>Date de prise d’effet<b class="requis">*</b></span>
              <input aria-required="true" type="date" [formField]="f.date_debut" />
              <app-erreur [champ]="f.date_debut" />
            </label>
            <label class="champ l2">
              <span>Durée<b class="requis">*</b></span>
              <div class="saisie" data-suffixe="mois">
                <input aria-required="true" type="text" inputmode="numeric" [formField]="f.duree_mois" />
              </div>
              <app-erreur [champ]="f.duree_mois" />
            </label>
            <label class="champ case l2">
              <input type="checkbox" [formField]="f.tacite_reconduction" />
              <span>Tacite reconduction</span>
            </label>
            <label class="champ l6">
              <span>Destination des locaux</span>
              <input [formField]="f.destination" placeholder="Usage exclusif d’habitation principale" />
            </label>
            @if (!f.date_sortie().hidden()) {
              <label class="champ l2">
                <span>Date de sortie</span>
                <input type="date" [formField]="f.date_sortie" />
                <app-erreur [champ]="f.date_sortie" />
              </label>
              <label class="champ l4">
                <span>Motif de sortie</span>
                <input [formField]="f.motif_sortie" />
              </label>
            }
          </div>
        </fieldset>

        <fieldset class="carte">
          <legend>Conditions financières</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Loyer hors charges<b class="requis">*</b></span>
              <div class="saisie" data-suffixe="€">
                <input aria-required="true" type="text" inputmode="decimal" [formField]="f.loyer_hc" />
              </div>
              <app-erreur [champ]="f.loyer_hc" />
            </label>
            <label class="champ l2">
              <span>Charges<b class="requis">*</b></span>
              <div class="saisie" data-suffixe="€">
                <input aria-required="true" type="text" inputmode="decimal" [formField]="f.charges" />
              </div>
              <app-erreur [champ]="f.charges" />
            </label>
            <label class="champ l2">
              <span>Mode des charges<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.mode_charges">
                @for (o of options.modeCharges; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Dépôt de garantie<b class="requis">*</b></span>
              <div class="saisie" data-suffixe="€">
                <input aria-required="true" type="text" inputmode="decimal" [formField]="f.depot_garantie" />
              </div>
              <app-erreur [champ]="f.depot_garantie" />
            </label>
          </div>
          @if (aideDepot(); as aide) {
            <p class="alerte">{{ aide }}</p>
          }
        </fieldset>

        <fieldset class="carte">
          <legend>Paiement</legend>
          <div class="grille-champs">
            <label class="champ l2">
              <span>Jour de paiement<b class="requis">*</b></span>
              <input aria-required="true" type="text" inputmode="numeric" [formField]="f.jour_paiement" />
              <app-erreur [champ]="f.jour_paiement" />
            </label>
            <label class="champ l2">
              <span>Terme<b class="requis">*</b></span>
              <select aria-required="true" [formField]="f.paiement_terme">
                @for (o of options.termePaiement; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label class="champ l2">
              <span>Mode de paiement</span>
              <select [formField]="f.mode_paiement">
                <option value="">—</option>
                @for (o of options.modePaiement; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
          </div>
        </fieldset>

        @if (!f.zone_tendue().hidden()) {
          <fieldset class="carte">
            <legend>Révision & encadrement</legend>
            <div class="grille-champs">
              <label class="champ l2">
                <span>Trimestre IRL de référence</span>
                <input [formField]="f.irl_trimestre_reference" placeholder="T2 2025" />
                <app-erreur [champ]="f.irl_trimestre_reference" />
              </label>
              <label class="champ l2">
                <span>Valeur IRL de référence</span>
                <input type="text" inputmode="decimal" [formField]="f.irl_valeur_reference" />
                <app-erreur [champ]="f.irl_valeur_reference" />
              </label>
              <label class="champ case l2">
                <input type="checkbox" [formField]="f.zone_tendue" />
                <span>Zone tendue / encadrement</span>
              </label>
              @if (!f.loyer_reference_majore().hidden()) {
                <label class="champ l2">
                  <span>Loyer de référence majoré</span>
                  <div class="saisie" data-suffixe="€/m²">
                    <input type="text" inputmode="decimal" [formField]="f.loyer_reference_majore" />
                  </div>
                  <app-erreur [champ]="f.loyer_reference_majore" />
                </label>
                <label class="champ l2">
                  <span>Complément de loyer</span>
                  <div class="saisie" data-suffixe="€">
                    <input type="text" inputmode="decimal" [formField]="f.complement_loyer" />
                  </div>
                  <app-erreur [champ]="f.complement_loyer" />
                </label>
                <label class="champ l2">
                  <span>Loyer du locataire précédent</span>
                  <div class="saisie" data-suffixe="€">
                    <input type="text" inputmode="decimal" [formField]="f.dernier_loyer_precedent" />
                  </div>
                  <app-erreur [champ]="f.dernier_loyer_precedent" />
                </label>
              }
            </div>
          </fieldset>
        }

        <fieldset class="carte">
          <legend>Clauses & notes</legend>
          <div class="grille-champs">
            <label class="champ l6">
              <span>Clauses particulières</span>
              <textarea rows="3" [formField]="f.clauses_particulieres"></textarea>
            </label>
            <label class="champ l6">
              <span>Notes internes (non imprimées)</span>
              <textarea rows="3" [formField]="f.notes"></textarea>
            </label>
          </div>
        </fieldset>

        <div class="actions-formulaire">
          <button type="button" class="btn" (click)="retour()">Annuler</button>
          <button type="submit" class="btn primaire" [disabled]="f().submitting()">Enregistrer</button>
        </div>
      </form>
    } @else if (complet.error()) {
      <p class="alerte">Bail introuvable.</p>
    } @else if (listes.error()) {
      <p class="alerte">Impossible de charger les biens et locataires.</p>
    }
  `,
})
export class BailForm {
  readonly id = input(null, { transform: idRoute });
  readonly bien = input(null, { transform: idRoute });
  readonly locataire = input(null, { transform: idRoute });

  private readonly bdd = inject(BaseDeDonnees);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);
  private readonly brouillons = inject(Brouillons);

  protected readonly options = OPTIONS;

  /** Saisie laissée avant de créer un locataire, reprise une seule fois au retour sur ce formulaire. */
  private readonly brouillon = computed(() => this.brouillons.reprendre<BrouillonBail>(cleBrouillon(this.id())));

  /** Listes de choix (biens, locataires), nécessaires en création comme en modification. */
  protected readonly listes = resource({
    loader: async () => {
      const depot = this.bdd.depot;
      const [biens, locataires] = await Promise.all([depot.biens.listerResumes(), depot.locataires.lister()]);
      return { biens, locataires };
    },
  });
  /** Bail modifié avec ses locataires ; sans id (création), la resource reste inactive et le loader n'est pas appelé. */
  protected readonly complet = resource({
    params: () => this.id() ?? undefined,
    loader: async ({ params: id }) => {
      const complet = await this.bdd.depot.baux.obtenirComplet(id);
      if (!complet) throw new Error('Bail introuvable');
      return complet;
    },
  });
  /** Formulaire affiché une fois les listes chargées (et le bail, en modification). */
  protected readonly pret = computed(() => this.listes.hasValue() && (!this.id() || this.complet.hasValue()));

  private readonly original = computed(() => (this.complet.hasValue() ? this.complet.value().bail : null));

  protected readonly biens = computed(() => {
    if (!this.listes.hasValue()) return [];
    const id = this.id();
    return this.listes.value().biens.map((b) => ({
      id: b.id,
      libelle: `${b.libelle} — ${b.detenteur === 'societe' ? b.societe_nom : 'nom propre'}${b.bail_actif_id && b.bail_actif_id !== id ? ' (loué)' : ''}`,
    }));
  });

  /** Modèle du bail : le bail chargé, ou des valeurs par défaut adaptées au bien pré-sélectionné. */
  protected readonly modele = linkedSignal<ModeleBail>(() => {
    const brouillon = this.brouillon();
    if (brouillon) return brouillon.modele;
    const bail = this.original();
    if (bail) return { ...textes(CLES, bail), tacite_reconduction: !!bail.tacite_reconduction, zone_tendue: !!bail.zone_tendue };
    const bienId = this.bien();
    const bien = this.listes.hasValue() ? this.listes.value().biens.find((b) => b.id === bienId) : undefined;
    const type: TypeBail = bien?.meuble ? 'habitation_meuble' : 'habitation_vide';
    return {
      ...textes(CLES, {
        bien_id: bienId,
        type_bail: type,
        statut: 'actif',
        date_debut: aujourdhui(),
        date_signature: aujourdhui(),
        duree_mois: DUREE_DEFAUT_BAIL[type],
        charges: 0,
        mode_charges: 'provision',
        depot_garantie: 0,
        jour_paiement: 1,
        paiement_terme: 'echoir',
        mode_paiement: 'virement',
      }),
      tacite_reconduction: true,
      zone_tendue: false,
    };
  });

  protected readonly f = form(this.modele, (p) => {
    hidden(p.date_sortie, { when: ({ valueOf }) => valueOf(p.statut) !== 'termine' });
    hidden(p.motif_sortie, { when: ({ valueOf }) => valueOf(p.statut) !== 'termine' });
    for (const champ of [p.irl_trimestre_reference, p.irl_valeur_reference]) {
      hidden(champ, { when: ({ valueOf }) => !TYPES_HABITATION.includes(valueOf(p.type_bail)) });
    }
    hidden(p.zone_tendue, { when: ({ valueOf }) => !TYPES_HABITATION.includes(valueOf(p.type_bail)) });
    for (const champ of [p.loyer_reference_majore, p.complement_loyer, p.dernier_loyer_precedent]) {
      hidden(champ, { when: ({ valueOf }) => !TYPES_HABITATION.includes(valueOf(p.type_bail)) || !valueOf(p.zone_tendue) });
    }
    validateStandardSchema(p, SCHEMA.validation);
  });

  /**
   * Sélection des locataires : une ligne par locataire connu, initialisée avec ceux du brouillon ou du bail,
   * plus celui passé dans l'URL (locataire tout juste créé, ou bail créé depuis une fiche locataire).
   */
  protected readonly choix = linkedSignal<ChoixLocataire[]>(() => {
    if (!this.listes.hasValue()) return [];
    const { locataires } = this.listes.value();
    const brouillon = this.brouillon();
    const complet = this.complet.hasValue() ? this.complet.value() : null;
    const roles = new Map<number, RoleLocataire>(
      brouillon?.roles ?? complet?.locataires.map((l) => [l.id, l.role]) ?? [],
    );
    const loc = this.locataire();
    if (loc && !roles.has(loc)) {
      roles.set(loc, [...roles.values()].includes('titulaire') ? 'colocataire' : 'titulaire');
    }
    return locataires.map((l: Locataire) => ({
      locataire_id: l.id,
      nom: nomComplet(l),
      coche: roles.has(l.id),
      role: roles.get(l.id) ?? 'colocataire',
    }));
  });
  protected readonly fChoix = form(this.choix);
  private readonly selection = computed(() => this.choix().filter((c) => c.coche));

  /** Vrai après une tentative d'enregistrement : les erreurs de sélection s'affichent alors et suivent la saisie. */
  private readonly soumis = signal(false);
  private readonly problemeLocataires = computed(() => {
    const selection = this.selection();
    if (selection.length === 0) {
      return this.modele().statut === 'brouillon'
        ? ''
        : 'Sélectionnez au moins un locataire (ou enregistrez le bail en brouillon).';
    }
    return selection.some((c) => c.role === 'titulaire') ? '' : 'Désignez un locataire titulaire.';
  });
  protected readonly erreurLocataires = computed(() => (this.soumis() ? this.problemeLocataires() : ''));

  protected readonly aideDepot = computed(() => {
    const m = this.modele();
    const depot = nombre(m.depot_garantie);
    const max = depotGarantieMaximum(m.type_bail as TypeBail, nombre(m.loyer_hc) ?? 0);
    if (max === null || depot === null) return '';
    return depot > max
      ? `Attention : le dépôt de garantie dépasse le maximum légal pour ce type de bail (${formatEuro(max)}).`
      : '';
  });

  /** Un changement de type de bail réapplique la durée et la reconduction par défaut de ce type. */
  protected appliquerDefautsType(type: TypeBail) {
    this.modele.update((m) => ({
      ...m,
      duree_mois: String(DUREE_DEFAUT_BAIL[type]),
      tacite_reconduction: type !== 'mobilite' && type !== 'etudiant',
    }));
  }

  /**
   * À la sélection d'un locataire, le premier coché devient titulaire, les suivants colocataires.
   * Si le titulaire est décoché, le premier locataire encore coché le remplace.
   */
  protected surCoche(index: number, coche: boolean) {
    this.choix.update((liste) => {
      const autres = liste.some((c, i) => i !== index && c.coche);
      const maj = liste.map((c, i): ChoixLocataire =>
        i === index ? { ...c, coche, role: coche ? (autres ? 'colocataire' : 'titulaire') : c.role } : c,
      );
      const coches = maj.filter((c) => c.coche);
      if (coches.length === 0 || coches.some((c) => c.role === 'titulaire')) return maj;
      const premier = coches[0]!.locataire_id;
      return maj.map((c) => (c.locataire_id === premier ? { ...c, role: 'titulaire' } : c));
    });
  }

  /** Conserve la saisie puis ouvre la création d'un locataire, qui reviendra ici en le sélectionnant. */
  protected nouveauLocataire() {
    const id = this.id();
    this.brouillons.conserver<BrouillonBail>(cleBrouillon(id), {
      modele: this.modele(),
      roles: this.selection().map((c) => [c.locataire_id, c.role]),
    });
    const retourVers = id ? `/baux/${id}/modifier` : '/baux/nouveau';
    this.router.navigate(['/locataires/nouveau'], { queryParams: { retourVers } });
  }

  protected enregistrer(event: Event) {
    event.preventDefault();
    this.soumis.set(true);
    if (this.problemeLocataires()) return;
    submit(this.f, async () => {
      const data = SCHEMA.parse(this.modele());
      try {
        const depot = this.bdd.depot;
        const original = this.original();
        let id = this.id();
        await depot.baux.verifierChevauchement({ ...data, id: id ?? undefined });
        if (id) await depot.baux.modifier(id, data);
        else id = await depot.baux.creer(data);
        await depot.baux.definirLocataires(
          id,
          this.selection().map(({ locataire_id, role }) => ({ locataire_id, role })),
        );

        const bail = await depot.baux.exiger(id);
        const modifie = !original || CHAMPS_ECHEANCES.some((k) => original[k] !== bail[k]);
        if (modifie) await depot.loyers.recalculer(bail, this.recalculerAPartirDe(bail), aujourdhui());

        this.notifications.succes('Bail enregistré');
        await this.router.navigate(['/baux', id]);
      } catch (e) {
        this.notifications.erreur(e);
      }
      return undefined;
    });
  }

  /**
   * Première période à régénérer après enregistrement : tout le bail à la création ; en modification,
   * seulement depuis la dernière révision de loyer, pour ne pas réévaluer au loyer actuel
   * les échéances impayées antérieures (qui portent encore l'ancien loyer).
   */
  private recalculerAPartirDe(bail: Bail): Periode {
    const revisions = this.complet.hasValue() ? this.complet.value().revisions : [];
    const derniere = revisions.map((r) => r.date_effet).sort().at(-1);
    if (!this.original() || !derniere) return periodeDe(bail.date_debut);
    return periodeDe(derniere);
  }

  protected retour() {
    const id = this.id();
    this.router.navigate(id ? ['/baux', id] : ['/baux']);
  }
}

function cleBrouillon(id: number | null) {
  return `bail:${id ?? 'nouveau'}`;
}
