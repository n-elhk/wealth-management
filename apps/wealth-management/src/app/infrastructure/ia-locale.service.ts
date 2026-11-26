import { Service } from '@angular/core';
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
 * Desktop uniquement : sur mobile, les commandes n'existent pas et `etat()` renvoie `null`.
 * Aucun serveur ni service distant : seul le téléchargement initial du modèle utilise le réseau.
 */
@Service()
export class IaLocale {
  /** `null` si l'IA locale n'est pas disponible sur cette plateforme. */
  async etat(): Promise<EtatIa | null> {
    try {
      return await invoke<EtatIa>('ia_etat');
    } catch {
      return null;
    }
  }

  /** Télécharge (ou reprend) le modèle ; les fichiers sont vérifiés par SHA-256. */
  telecharger(progression: (p: ProgressionTelechargement) => void): Promise<void> {
    const canal = new Channel<ProgressionTelechargement>();
    canal.onmessage = progression;
    return invoke('ia_telecharger', { canal });
  }

  /** Interrompt le téléchargement ou l'analyse en cours. */
  annuler(): Promise<void> {
    return invoke('ia_annuler');
  }

  /** Libère la mémoire occupée par le modèle (≈ 5 Go). */
  decharger(): Promise<void> {
    return invoke('ia_decharger');
  }

  /** Texte d'un PDF ou d'un tableur, au format Markdown. */
  extraireTexte(chemin: string): Promise<string> {
    return invoke('ia_extraire_texte', { chemin });
  }

  compterTokens(texte: string): Promise<number> {
    return invoke('ia_compter_tokens', { texte });
  }

  /** Réponse du modèle au prompt (décodage glouton, température 0). */
  generer(prompt: string, maxTokens: number, progression: (p: ProgressionGeneration) => void): Promise<string> {
    const canal = new Channel<ProgressionGeneration>();
    canal.onmessage = progression;
    return invoke('ia_generer', { prompt, maxTokens, canal });
  }
}
