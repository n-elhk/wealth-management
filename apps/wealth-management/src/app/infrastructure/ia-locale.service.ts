import { Service, resource, signal } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';

/** État du modèle de langage local (commandes `ia_*` de `src-tauri/src/ia`). */
export interface EtatIa {
  installe: boolean;
  charge: boolean;
  /** Taille totale des fichiers à télécharger, en octets. */
  tailleTotale: number;
  /** Fenêtre de contexte du modèle, en tokens. */
  contexte: number;
}

export interface ProgressionTelechargement {
  fichier: string;
  recu: number;
  total: number;
}

export type ProgressionGeneration =
  | { etape: 'chargement' }
  | { etape: 'prompt'; traite: number; total: number }
  | { etape: 'generation'; tokens: number; max: number };

/**
 * Modèle de langage local (Mistral 7B Instruct via Candle) et extraction de documents (xberg), côté Rust.
 * Desktop uniquement : sur mobile, les commandes n'existent pas et `etat` vaut `null`.
 * Aucun serveur ni service distant : seul le téléchargement initial du modèle utilise le réseau.
 *
 * L'état et le téléchargement sont partagés entre les écrans : le téléchargement (lancé depuis
 * les paramètres) continue si l'on change de page, et la liste des baux sait si le modèle est installé.
 */
@Service()
export class IaLocale {
  /** `null` si l'IA locale n'est pas disponible sur cette plateforme. Rechargé après chaque opération. */
  readonly etat = resource({ loader: () => this.lireEtat() });

  private readonly _telechargement = signal<ProgressionTelechargement | null>(null);
  /** Progression du téléchargement en cours, `null` s'il n'y en a pas. */
  readonly telechargement = this._telechargement.asReadonly();

  private async lireEtat(): Promise<EtatIa | null> {
    try {
      return await invoke<EtatIa>('ia_etat');
    } catch {
      return null;
    }
  }

  /** Télécharge (ou reprend) le modèle ; les fichiers sont vérifiés par SHA-256. */
  async telecharger(): Promise<void> {
    if (this._telechargement()) return;
    this._telechargement.set({ fichier: '', recu: 0, total: 0 });
    const canal = new Channel<ProgressionTelechargement>();
    canal.onmessage = (p) => this._telechargement.set(p);
    try {
      await invoke('ia_telecharger', { canal });
    } finally {
      this._telechargement.set(null);
      this.etat.reload();
    }
  }

  /** Interrompt le téléchargement ou l'analyse en cours. */
  annuler(): Promise<void> {
    return invoke('ia_annuler');
  }

  /** Libère la mémoire occupée par le modèle (≈ 5 Go). */
  async decharger(): Promise<void> {
    try {
      await invoke('ia_decharger');
    } finally {
      this.etat.reload();
    }
  }

  /** Texte d'un PDF ou d'un tableur, au format Markdown. */
  extraireTexte(chemin: string): Promise<string> {
    return invoke('ia_extraire_texte', { chemin });
  }

  compterTokens(texte: string): Promise<number> {
    return invoke('ia_compter_tokens', { texte });
  }

  /** Réponse du modèle au prompt (décodage glouton, température 0). */
  async generer(prompt: string, maxTokens: number, progression: (p: ProgressionGeneration) => void): Promise<string> {
    const canal = new Channel<ProgressionGeneration>();
    canal.onmessage = progression;
    try {
      return await invoke('ia_generer', { prompt, maxTokens, canal });
    } finally {
      // Le modèle reste chargé après une analyse : « Libérer la mémoire » apparaît.
      this.etat.reload();
    }
  }
}
