import { Service, resource, signal } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { ExtractionDocument } from '@wealth-management/core/import';

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

/** Étape d'une analyse en cours, pour l'affichage (message annoncé, jauge, détail). */
export interface EtapeAnalyse {
  /** Étape en cours, annoncée aux lecteurs d'écran (change rarement). */
  etape: string;
  valeur?: number;
  max?: number;
  detail?: string;
}

/** Réponse brute du modèle pour un document, à analyser par le module d'import correspondant. */
export interface AnalyseDocument {
  sortie: string;
  /** Le document dépassait le contexte du modèle : seuls les passages utiles ont été analysés. */
  reduit: boolean;
}

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

  /**
   * Analyse complète d'un document : extraction du texte, réduction au contexte du modèle,
   * génération. La réponse est à valider par le module d'import du type de document.
   *
   * `signal` interrompt l'analyse à n'importe quelle étape : la promesse est alors rejetée avec
   * `signal.reason` (vérifier `signal.aborted` plutôt que d'afficher l'erreur). Côté Rust, le drapeau
   * d'annulation reste levé jusqu'à la prochaine analyse, donc la génération ne démarre pas.
   */
  async analyserDocument(
    chemin: string,
    extraction: ExtractionDocument,
    progression: (e: EtapeAnalyse) => void,
    signal: AbortSignal,
  ): Promise<AnalyseDocument> {
    signal.throwIfAborted();
    const contexte = this.etat.value()?.contexte;
    if (!contexte) throw new Error('Le modèle d’IA locale n’est pas disponible.');
    await invoke('ia_nouvelle_analyse');
    const interrompre = () => void this.annuler();
    signal.addEventListener('abort', interrompre, { once: true });
    try {
      progression({ etape: 'Lecture du document…' });
      const texte = await this.extraireTexte(chemin);
      signal.throwIfAborted();
      progression({ etape: 'Préparation de l’analyse…' });
      const { document, reduit } = await this.ajusterAuContexte(texte, contexte, extraction, signal);
      const sortie = await this.generer(extraction.prompt(document), extraction.maxTokens, (p) =>
        progression(etapeGeneration(p)),
      );
      signal.throwIfAborted();
      return { sortie, reduit };
    } catch (e) {
      // « Analyse annulée. » renvoyé par Rust : on rejette avec la raison de l'annulation.
      signal.throwIfAborted();
      throw e;
    } finally {
      signal.removeEventListener('abort', interrompre);
    }
  }

  /**
   * Réduit le document pour que prompt + réponse tiennent dans le contexte du modèle (4 096 tokens) :
   * estimation à ~3 caractères par token, puis ajustement sur le compte exact du tokenizer.
   */
  private async ajusterAuContexte(
    texte: string,
    contexte: number,
    extraction: ExtractionDocument,
    signal: AbortSignal,
  ): Promise<{ document: string; reduit: boolean }> {
    const disponible = contexte - extraction.maxTokens;
    const base = await this.compterTokens(extraction.prompt(''));
    let caracteres = Math.max(500, (disponible - base) * 3);
    for (let essai = 0; essai < 5; essai++) {
      signal.throwIfAborted();
      const document = extraction.selectionner(texte, caracteres);
      const tokens = await this.compterTokens(extraction.prompt(document));
      if (tokens <= disponible) return { document, reduit: document.length < texte.trim().length * 0.95 };
      caracteres = Math.floor(caracteres * ((disponible - base) / (tokens - base)) * 0.95);
    }
    throw new Error('Impossible de réduire ce document à la taille acceptée par le modèle.');
  }

  /** Réponse du modèle au prompt (décodage glouton, température 0), après `ia_nouvelle_analyse`. */
  private async generer(prompt: string, maxTokens: number, progression: (p: ProgressionGeneration) => void): Promise<string> {
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

function etapeGeneration(p: ProgressionGeneration): EtapeAnalyse {
  switch (p.etape) {
    case 'chargement':
      return { etape: 'Chargement du modèle en mémoire…', detail: 'Une quinzaine de secondes au premier lancement.' };
    case 'prompt':
      return { etape: 'Lecture du document par le modèle…', valeur: p.traite, max: p.total, detail: `${p.traite} / ${p.total} tokens` };
    case 'generation':
      return { etape: 'Extraction des informations…', valeur: p.tokens, max: p.max, detail: `${p.tokens} tokens générés` };
  }
}
