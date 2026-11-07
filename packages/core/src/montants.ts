/** Arrondi bancaire au centime. */
export function arrondi(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function somme(values: Iterable<number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += v ?? 0;
  return arrondi(total);
}

const euroFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function formatEuro(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  // Intl utilise des espaces fines insécables, peu lisibles dans les PDF : on normalise.
  return euroFormatter.format(n).replace(/[  ]/g, ' ');
}

// ---------------------------------------------------------------------------
// Montant en toutes lettres (orthographe traditionnelle)
// ---------------------------------------------------------------------------

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', '', 'quatre-vingt'];

function moinsDeCent(n: number): string {
  if (n < 17) return UNITES[n]!;
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  const t = Math.floor(n / 10);
  const r = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? 'soixante' : 'quatre-vingt';
    if (t === 7 && r === 1) return 'soixante et onze';
    return `${base}-${moinsDeCent(10 + r)}`;
  }
  const base = DIZAINES[t]!;
  if (r === 0) return t === 8 ? 'quatre-vingts' : base;
  if (r === 1 && t !== 8) return `${base} et un`;
  return `${base}-${UNITES[r]}`;
}

function moinsDeMille(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c === 0) return moinsDeCent(r);
  const cents = c === 1 ? 'cent' : `${UNITES[c]} cent`;
  if (r === 0) return c > 1 ? `${cents}s` : cents;
  return `${cents} ${moinsDeCent(r)}`;
}

/** Nombre entier (0 à 999 999 999) en lettres. */
export function nombreEnLettres(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;
  if (millions) parts.push(`${moinsDeMille(millions)} million${millions > 1 ? 's' : ''}`);
  if (milliers) {
    // « cent » et « vingt » restent invariables devant « mille ».
    parts.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers).replace(/(cent|vingt)s$/, '$1')} mille`);
  }
  if (reste) parts.push(moinsDeMille(reste));
  return parts.join(' ');
}

/** 1234.5 → « mille deux cent trente-quatre euros et cinquante centimes » */
export function montantEnLettres(montant: number): string {
  const total = Math.round(Math.abs(montant) * 100);
  const euros = Math.floor(total / 100);
  const centimes = total % 100;
  let txt = `${nombreEnLettres(euros)} euro${euros > 1 ? 's' : ''}`;
  if (euros > 0 && euros % 1_000_000 === 0) txt = txt.replace(/ euros$/, " d'euros");
  if (centimes) txt += ` et ${nombreEnLettres(centimes)} centime${centimes > 1 ? 's' : ''}`;
  return txt;
}
