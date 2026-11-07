import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Ligne de tableau cliquable à la souris. La cible accessible reste le vrai lien `<a>` placé dans
 * une cellule (clavier, lecteur d'écran, clic milieu) : un clic ailleurs sur la ligne le déclenche.
 */
@Directive({
  selector: 'tr[appLigneCliquable]',
  host: { class: 'cliquable', '(click)': 'ouvrir($event)' },
})
export class LigneCliquable {
  private readonly ligne = inject<ElementRef<HTMLTableRowElement>>(ElementRef);

  protected ouvrir(event: MouseEvent) {
    // Clic sur un élément interactif, ou sélection de texte en cours : on ne détourne rien.
    if ((event.target as Element).closest('a, button, input, select, textarea')) return;
    if (getSelection()?.toString()) return;
    this.ligne.nativeElement.querySelector<HTMLAnchorElement>('a[href]')?.click();
  }
}
