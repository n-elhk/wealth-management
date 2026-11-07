import type { Routes } from '@angular/router';

/** Location : locataires et baux (garants, fin de bail). */
export const LOCATION_ROUTES: Routes = [
  { path: 'locataires', loadComponent: () => import('./locataires/locataires-liste').then((m) => m.LocatairesListe), title: 'Locataires' },
  { path: 'locataires/nouveau', loadComponent: () => import('./locataires/locataire-form').then((m) => m.LocataireForm), title: 'Nouveau locataire' },
  { path: 'locataires/:id', loadComponent: () => import('./locataires/locataire-detail').then((m) => m.LocataireDetail), title: 'Locataire' },
  { path: 'locataires/:id/modifier', loadComponent: () => import('./locataires/locataire-form').then((m) => m.LocataireForm), title: 'Modifier le locataire' },

  { path: 'baux', loadComponent: () => import('./baux/baux-liste').then((m) => m.BauxListe), title: 'Baux' },
  { path: 'baux/nouveau', loadComponent: () => import('./baux/bail-form').then((m) => m.BailForm), title: 'Nouveau bail' },
  { path: 'baux/:id', loadComponent: () => import('./baux/bail-detail').then((m) => m.BailDetail), title: 'Bail' },
  { path: 'baux/:id/modifier', loadComponent: () => import('./baux/bail-form').then((m) => m.BailForm), title: 'Modifier le bail' },
];
