import { Pipe, type PipeTransform } from '@angular/core';
import type { Option } from '@wealth-management/core';

/** Traduit une valeur codée via un dictionnaire de libellés. */
@Pipe({ name: 'libelle' })
export class LibellePipe implements PipeTransform {
  transform(v: string | null | undefined, dico: Record<string, string> | Option[]): string {
    if (v === null || v === undefined) return '';
    if (Array.isArray(dico)) return dico.find((o) => o.value === v)?.label ?? v;
    return dico[v] ?? v;
  }
}
