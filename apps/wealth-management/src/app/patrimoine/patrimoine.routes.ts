import type { Routes } from '@angular/router';

/** Patrimoine : sociétés détentrices et biens immobiliers. */
export const PATRIMOINE_ROUTES: Routes = [
  { path: 'societes', loadComponent: () => import('./societes/societes-liste').then((m) => m.SocietesListe), title: 'Sociétés' },
  { path: 'societes/nouvelle', loadComponent: () => import('./societes/societe-form').then((m) => m.SocieteForm), title: 'Nouvelle société' },
  { path: 'societes/:id', loadComponent: () => import('./societes/societe-detail').then((m) => m.SocieteDetail), title: 'Société' },
  { path: 'societes/:id/modifier', loadComponent: () => import('./societes/societe-form').then((m) => m.SocieteForm), title: 'Modifier la société' },

  { path: 'biens', loadComponent: () => import('./biens/biens-liste').then((m) => m.BiensListe), title: 'Biens' },
  { path: 'biens/nouveau', loadComponent: () => import('./biens/bien-form').then((m) => m.BienForm), title: 'Nouveau bien' },
  { path: 'biens/:id', loadComponent: () => import('./biens/bien-detail').then((m) => m.BienDetail), title: 'Bien' },
  { path: 'biens/:id/modifier', loadComponent: () => import('./biens/bien-form').then((m) => m.BienForm), title: 'Modifier le bien' },
];
