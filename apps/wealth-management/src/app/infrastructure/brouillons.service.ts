import { Service } from '@angular/core';

/**
 * Saisies en cours conservées en mémoire le temps d'un aller-retour vers un autre écran
 * (ex. création d'un locataire depuis le formulaire de bail). Chaque brouillon est lu une seule fois.
 */
@Service()
export class Brouillons {
  private readonly saisies = new Map<string, unknown>();

  conserver<T>(cle: string, valeur: T): void {
    this.saisies.set(cle, valeur);
  }

  /** Restitue le brouillon associé à la clé puis l'oublie. */
  reprendre<T>(cle: string): T | null {
    const valeur = this.saisies.get(cle);
    this.saisies.delete(cle);
    return (valeur as T | undefined) ?? null;
  }
}
