import { Component, input } from '@angular/core';

/** État vide homogène pour les listes. */
@Component({
  selector: 'app-vide',
  template: `<div class="vide"><p>{{ message() }}</p><ng-content /></div>`,
})
export class Vide {
  readonly message = input.required<string>();
}
