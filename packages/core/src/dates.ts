import { ISODateSchema, PeriodeSchema, type ISODate, type Periode } from './schemas.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse une date ISO `YYYY-MM-DD` en composantes (sans passer par Date pour éviter les fuseaux). */
export function parseISO(date: ISODate): { y: number; m: number; d: number } {
  if (!ISODateSchema.safeParse(date).success) throw new Error(`Date invalide : ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function aujourdhui(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function joursDansMois(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function periodeDe(date: ISODate): Periode {
  return date.slice(0, 7);
}

export function parsePeriode(periode: Periode): { y: number; m: number } {
  if (!PeriodeSchema.safeParse(periode).success) throw new Error(`Période invalide : ${periode}`);
  const [y, m] = periode.split('-').map(Number) as [number, number];
  return { y, m };
}

export function premierJour(periode: Periode): ISODate {
  const { y, m } = parsePeriode(periode);
  return toISO(y, m, 1);
}

export function dernierJour(periode: Periode): ISODate {
  const { y, m } = parsePeriode(periode);
  return toISO(y, m, joursDansMois(y, m));
}

export function periodeSuivante(periode: Periode, n = 1): Periode {
  const { y, m } = parsePeriode(periode);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Ajoute `n` mois en bornant le jour à la fin du mois cible (31/01 + 1 mois = 28/02). */
export function ajouterMois(date: ISODate, n: number): ISODate {
  const { y, m, d } = parseISO(date);
  const target = periodeSuivante(`${y}-${pad(m)}`, n);
  const { y: ty, m: tm } = parsePeriode(target);
  return toISO(ty, tm, Math.min(d, joursDansMois(ty, tm)));
}

export function ajouterJours(date: ISODate, n: number): ISODate {
  const { y, m, d } = parseISO(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Nombre de jours entre deux dates incluses. */
export function joursInclus(debut: ISODate, fin: ISODate): number {
  const a = parseISO(debut);
  const b = parseISO(fin);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000) + 1;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Âge en années révolues à une date donnée. */
export function age(dateNaissance: ISODate, aLaDate: ISODate): number {
  const n = parseISO(dateNaissance);
  const r = parseISO(aLaDate);
  let a = r.y - n.y;
  if (r.m < n.m || (r.m === n.m && r.d < n.d)) a -= 1;
  return a;
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** `2025-03` → `mars 2025` */
export function libellePeriode(periode: Periode): string {
  const { y, m } = parsePeriode(periode);
  return `${MOIS[m - 1]} ${y}`;
}

/** `2025-03-07` → `07/03/2025` */
export function formatDateFr(date: ISODate | null | undefined): string {
  if (!date) return '';
  const { y, m, d } = parseISO(date);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** `2025-03-07` → `7 mars 2025` */
export function formatDateLongue(date: ISODate | null | undefined): string {
  if (!date) return '';
  const { y, m, d } = parseISO(date);
  return `${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
}
