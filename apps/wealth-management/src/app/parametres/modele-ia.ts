import { Component, computed, inject } from '@angular/core';
import { IaLocale, type ModeleIaLocale } from '../infrastructure/ia-locale.service';
import { Notifications } from '../ui/notifications.service';

const GO = 1024 ** 3;

function taille(octets: number) {
  return `${(octets / GO).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

interface LigneModele {
  modele: ModeleIaLocale;
  titre: string;
  description: string;
  installe: boolean;
}

/**
 * Installation des modèles d'IA locale utilisés pour l'import de documents (desktop uniquement :
 * rien n'est affiché sur mobile) : Mistral (indispensable) et l'OCR des PDF scannés (facultatif).
 * Un téléchargement continue si l'on quitte la page ; un seul à la fois.
 */
@Component({
  selector: 'app-modele-ia',
  template: `
    @if (ia.etat.hasValue()) {
      @let e = ia.etat.value();
      @if (e) {
        <section class="carte" aria-labelledby="titre-modele-ia">
          <h2 id="titre-modele-ia">IA locale (import de documents)</h2>
          <p class="muted">
            L’import de documents (baux, statuts de société) s’exécute entièrement sur cet ordinateur : aucun document
            n’est envoyé sur Internet. Les modèles sont téléchargés une seule fois depuis Hugging Face, puis vérifiés.
          </p>

          <!-- Zone live toujours présente : seul son contenu change, ce qui garantit l'annonce (VoiceOver / WebKit). -->
          <p role="status" class="etape">{{ annonce() }}</p>

          @for (l of lignes(); track l.modele) {
            <h3 [id]="'titre-' + l.modele">{{ l.titre }}</h3>
            <p class="muted">{{ l.description }}</p>
            @if (enCours(l.modele); as p) {
              <div class="progression">
                @if (p.total) {
                  <progress [value]="p.recu" [max]="p.total" [attr.aria-labelledby]="'titre-' + l.modele"></progress>
                  <p class="muted">{{ p.fichier }} : {{ taille(p.recu) }} sur {{ taille(p.total) }}</p>
                } @else {
                  <progress [attr.aria-labelledby]="'titre-' + l.modele"></progress>
                }
                <button type="button" class="btn" (click)="annuler()">Interrompre</button>
              </div>
            } @else if (l.installe) {
              <p><strong>Installé.</strong>{{ l.modele === 'langage' && e.charge ? ' Chargé en mémoire.' : '' }}</p>
              @if (l.modele === 'langage' && e.charge) {
                <button type="button" class="btn" (click)="decharger()">Libérer la mémoire du modèle</button>
              }
            } @else {
              <!-- Un seul téléchargement à la fois : le bouton reste visible mais inactif pendant l'autre. -->
              <button
                type="button"
                class="btn"
                [class.primaire]="l.modele === 'langage'"
                [disabled]="!!ia.telechargement()"
                [attr.aria-label]="'Télécharger le modèle : ' + l.titre"
                (click)="telecharger(l.modele)"
              >
                Télécharger
              </button>
            }
          }
        </section>
      }
    }
  `,
})
export class ModeleIa {
  protected readonly ia = inject(IaLocale);
  private readonly notifications = inject(Notifications);
  protected readonly taille = taille;

  protected readonly lignes = computed((): LigneModele[] => {
    const e = this.ia.etat.hasValue() ? this.ia.etat.value() : null;
    if (!e) return [];
    return [
      {
        modele: 'langage',
        titre: 'Lecture des documents',
        description: `Mistral 7B Instruct (${taille(e.tailleTotale)}) lit le texte des documents et en extrait les informations. 16 Go de mémoire vive sont conseillés.`,
        installe: e.installe,
      },
      {
        modele: 'ocr',
        titre: 'Lecture des PDF scannés (facultatif)',
        description: `PaddleOCR-VL (environ ${taille(e.tailleOcr)}) reconnaît le texte des PDF scannés ou dont le texte est dessiné. Leur analyse prend alors plusieurs minutes.`,
        installe: e.ocrInstalle,
      },
    ];
  });

  protected readonly annonce = computed(() => {
    const t = this.ia.telechargement();
    if (!t) return '';
    return t.modele === 'ocr' ? 'Téléchargement du modèle de lecture des PDF scannés…' : 'Téléchargement du modèle de lecture des documents…';
  });

  protected enCours(modele: ModeleIaLocale) {
    const t = this.ia.telechargement();
    return t?.modele === modele ? t : null;
  }

  protected async telecharger(modele: ModeleIaLocale) {
    try {
      await this.ia.telecharger(modele);
      this.notifications.succes('Modèle installé');
    } catch (e) {
      this.notifications.erreur(e);
    }
  }

  protected annuler() {
    void this.ia.annuler();
  }

  protected async decharger() {
    try {
      await this.ia.decharger();
    } catch (e) {
      this.notifications.erreur(e);
    }
  }
}
