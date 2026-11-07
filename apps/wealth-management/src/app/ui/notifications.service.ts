import { Service, inject, signal } from '@angular/core';
import { _IdGenerator } from '@angular/cdk/a11y';
import { confirm as confirmTauri } from '@tauri-apps/plugin-dialog';

export interface Notification {
  id: string;
  type: 'succes' | 'erreur' | 'info';
  message: string;
}

@Service()
export class Notifications {
  private readonly ids = inject(_IdGenerator);
  readonly liste = signal<Notification[]>([]);

  succes(message: string) {
    this.ajouter('succes', message);
  }

  info(message: string) {
    this.ajouter('info', message);
  }

  erreur(e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Une erreur est survenue';
    console.error(e);
    this.ajouter('erreur', traduireErreurSql(message), 8000);
  }

  fermer(id: string) {
    this.liste.update((l) => l.filter((n) => n.id !== id));
  }

  /** Boîte de confirmation native (fonctionne aussi sur mobile). */
  confirmer(message: string, titre = 'Confirmation'): Promise<boolean> {
    return confirmTauri(message, { title: titre, kind: 'warning', okLabel: 'Confirmer', cancelLabel: 'Annuler' });
  }

  private ajouter(type: Notification['type'], message: string, duree = 4000) {
    const id = this.ids.getId('notification-');
    this.liste.update((l) => [...l, { id, type, message }]);
    setTimeout(() => this.fermer(id), duree);
  }
}

function traduireErreurSql(message: string): string {
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return 'Opération impossible : cet élément est utilisé ailleurs (bail, bien, paiement…).';
  }
  if (/UNIQUE constraint failed/i.test(message)) return 'Cet élément existe déjà.';
  if (/CHECK constraint failed/i.test(message)) return 'Données incohérentes : vérifiez le formulaire.';
  return message;
}
