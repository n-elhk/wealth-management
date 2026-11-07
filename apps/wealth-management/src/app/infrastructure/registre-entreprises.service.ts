import { Service } from '@angular/core';
import { type SocieteRegistre, societeDepuisRegistre, urlRechercheSiren } from '@wealth-management/core';

/**
 * Consultation de l'API publique « Recherche d'entreprises » (recherche-entreprises.api.gouv.fr).
 * Le domaine est autorisé par la CSP (`connect-src` dans `tauri.conf.json`).
 */
@Service()
export class RegistreEntreprises {
  /** Société correspondant au SIREN (9 chiffres), `null` si inconnue ; lève une erreur si l'API est injoignable. */
  async rechercherSiren(siren: string, signal?: AbortSignal): Promise<SocieteRegistre | null> {
    const reponse = await fetch(urlRechercheSiren(siren), {
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (!reponse.ok) throw new Error(`Annuaire des entreprises indisponible (HTTP ${reponse.status})`);
    return societeDepuisRegistre(await reponse.json(), siren);
  }
}
