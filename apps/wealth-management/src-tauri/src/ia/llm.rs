//! Inférence locale de Mistral 7B Instruct (GGUF) avec Candle, sur CPU.
//!
//! Décodage glouton (température 0) : à document égal, la sortie est reproductible.
//! La génération s'arrête au token de fin `</s>` ou dès que le premier objet JSON est refermé.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use candle_core::quantized::gguf_file;
use candle_core::{Device, Tensor};
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_llama::{ModelWeights, MAX_SEQ_LEN};
use tokenizers::Tokenizer;

use super::telechargement::{GGUF, TOKENIZER};

/// Fenêtre de contexte : limitée par Candle (`MAX_SEQ_LEN`, tables RoPE précalculées).
pub const CONTEXTE: usize = MAX_SEQ_LEN;
/// Le prompt est injecté par blocs : mémoire d'attention bornée et progression affichable.
const BLOC_PROMPT: usize = 256;
const EOS: &str = "</s>";

pub enum Etape {
    Prompt { traite: usize, total: usize },
    Generation { tokens: usize },
}

pub fn charger_tokenizer(dossier: &Path) -> Result<Tokenizer, String> {
    Tokenizer::from_file(dossier.join(TOKENIZER.nom)).map_err(|e| format!("Tokenizer illisible : {e}"))
}

pub fn compter_tokens(tokenizer: &Tokenizer, texte: &str) -> Result<usize, String> {
    tokenizer
        .encode(texte, true)
        .map(|e| e.len())
        .map_err(|e| format!("Tokenisation impossible : {e}"))
}

pub struct Llm {
    modele: ModelWeights,
    /// Partagé avec `ia_compter_tokens` : chargé une seule fois.
    tokenizer: Arc<Tokenizer>,
    eos: u32,
    device: Device,
}

impl Llm {
    pub fn charger(dossier: &Path, tokenizer: Arc<Tokenizer>) -> Result<Self, String> {
        let device = Device::Cpu;
        let chemin = dossier.join(GGUF.nom);
        let mut fichier = std::fs::File::open(&chemin).map_err(|e| format!("Modèle introuvable : {e}"))?;
        let contenu = gguf_file::Content::read(&mut fichier).map_err(|e| format!("Modèle GGUF illisible : {e}"))?;
        let modele = ModelWeights::from_gguf(contenu, &mut fichier, &device)
            .map_err(|e| format!("Chargement du modèle impossible : {e}"))?;
        let eos = tokenizer.token_to_id(EOS).ok_or("Token de fin absent du tokenizer")?;
        Ok(Self { modele, tokenizer, eos, device })
    }

    /// Complète `prompt` (au format Mistral `[INST] … [/INST]`, le `<s>` initial est ajouté ici).
    pub fn generer(
        &mut self,
        prompt: &str,
        max_tokens: usize,
        annulation: &AtomicBool,
        mut progression: impl FnMut(Etape),
    ) -> Result<String, String> {
        // `max_tokens` vient du webview : borné avant toute soustraction.
        if max_tokens == 0 || max_tokens >= CONTEXTE {
            return Err(format!("Nombre de tokens à générer invalide ({max_tokens}, attendu entre 1 et {}).", CONTEXTE - 1));
        }
        let Self { modele, tokenizer, eos, device } = self;
        let erreur = |e: candle_core::Error| format!("Erreur d'inférence : {e}");
        let entree = tokenizer
            .encode(prompt, true)
            .map_err(|e| format!("Tokenisation impossible : {e}"))?
            .get_ids()
            .to_vec();
        let maximum = CONTEXTE - max_tokens;
        if entree.len() > maximum {
            return Err(format!("Document trop long pour le modèle ({} tokens, maximum {maximum}).", entree.len()));
        }

        modele.clear_kv_cache();
        let mut logits = None;
        for (i, bloc) in entree.chunks(BLOC_PROMPT).enumerate() {
            if annulation.load(Ordering::Relaxed) {
                return Err("Analyse annulée.".into());
            }
            let x = Tensor::new(bloc, device).and_then(|t| t.unsqueeze(0)).map_err(erreur)?;
            logits = Some(modele.forward(&x, i * BLOC_PROMPT).map_err(erreur)?);
            progression(Etape::Prompt { traite: (i * BLOC_PROMPT + bloc.len()), total: entree.len() });
        }
        let mut logits = logits.ok_or("Prompt vide")?;

        // Température 0 : argmax.
        let mut echantillonneur = LogitsProcessor::new(0, None, None);
        let mut sortie: Vec<u32> = Vec::with_capacity(max_tokens);
        // Décodage incrémental : seul le texte des nouveaux tokens est analysé (coût linéaire).
        let mut decodage = tokenizer.decode_stream(true);
        let mut suivi = SuiviJson::default();
        while sortie.len() < max_tokens {
            if annulation.load(Ordering::Relaxed) {
                return Err("Analyse annulée.".into());
            }
            let suivant = echantillonneur
                .sample(&logits.squeeze(0).map_err(erreur)?)
                .map_err(erreur)?;
            if suivant == *eos {
                break;
            }
            sortie.push(suivant);
            progression(Etape::Generation { tokens: sortie.len() });

            // Fin de l'objet JSON. `step` ne renvoie rien tant qu'un caractère UTF-8 est incomplet.
            let morceau = decodage.step(suivant).map_err(|e| format!("Décodage impossible : {e}"))?;
            if morceau.is_some_and(|m| suivi.avancer(&m)) {
                break;
            }

            let x = Tensor::new(&[suivant], device).and_then(|t| t.unsqueeze(0)).map_err(erreur)?;
            logits = modele.forward(&x, entree.len() + sortie.len() - 1).map_err(erreur)?;
        }
        modele.clear_kv_cache();
        // Décodage final complet : inclut d'éventuels octets que le flux retenait encore.
        tokenizer.decode(&sortie, true).map_err(|e| format!("Décodage impossible : {e}"))
    }
}

/// Suit la profondeur des accolades hors chaînes : vrai quand le premier objet JSON est refermé.
#[derive(Default)]
struct SuiviJson {
    profondeur: usize,
    ouvert: bool,
    dans_chaine: bool,
    echappe: bool,
}

impl SuiviJson {
    fn avancer(&mut self, texte: &str) -> bool {
        for c in texte.chars() {
            if self.dans_chaine {
                match (self.echappe, c) {
                    (true, _) => self.echappe = false,
                    (false, '\\') => self.echappe = true,
                    (false, '"') => self.dans_chaine = false,
                    _ => {}
                }
                continue;
            }
            match c {
                '"' if self.ouvert => self.dans_chaine = true,
                '{' => {
                    self.ouvert = true;
                    self.profondeur += 1;
                }
                '}' if self.ouvert => {
                    self.profondeur = self.profondeur.saturating_sub(1);
                    if self.profondeur == 0 {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::SuiviJson;

    #[test]
    fn detecte_la_fin_du_premier_objet() {
        let mut s = SuiviJson::default();
        assert!(!s.avancer("```json\n{\"a\": \"}{\\\"\", "));
        assert!(!s.avancer("\"b\": {\"c\": 1}"));
        assert!(s.avancer("}\n```"));
    }
}
