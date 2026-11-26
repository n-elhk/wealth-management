import { Component, inject } from '@angular/core';
import { IaLocale } from '../infrastructure/ia-locale.service';
import { Notifications } from '../ui/notifications.service';

const GO = 1024 ** 3;

function taille(octets: number) {
  return `${(octets / GO).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

/**
 * Installation du modèle d'IA locale utilisé pour l'import de documents (desktop uniquement :
 * rien n'est affiché sur mobile). Le téléchargement continue si l'on quitte la page.
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
            L’import de baux utilise Mistral 7B Instruct, exécuté sur cet ordinateur : aucun document n’est envoyé sur Internet.
            Le modèle ({{ taille(e.tailleTotale) }}) est téléchargé une seule fois depuis Hugging Face,
            puis vérifié ; 16 Go de mémoire vive sont conseillés.
          </p>

          @if (ia.telechargement(); as p) {
            <div class="progression">
              <p role="status">Téléchargement du modèle…</p>
              @if (p.total) {
                <progress [value]="p.recu" [max]="p.total" aria-label="Téléchargement du modèle"></progress>
                <p class="muted">{{ p.fichier }} : {{ taille(p.recu) }} sur {{ taille(p.total) }}</p>
              } @else {
                <progress aria-label="Téléchargement du modèle"></progress>
              }
              <button type="button" class="btn" (click)="annuler()">Interrompre</button>
            </div>
          } @else if (e.installe) {
            <p role="status"><strong>Modèle installé.</strong>{{ e.charge ? ' Il est chargé en mémoire.' : '' }}</p>
            @if (e.charge) {
              <button type="button" class="btn" (click)="decharger()">Libérer la mémoire du modèle</button>
            }
          } @else {
            <button type="button" class="btn primaire" (click)="telecharger()">Télécharger le modèle</button>
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

  protected async telecharger() {
    try {
      await this.ia.telecharger();
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
