import type { Routes } from '@angular/router';
import { LOCATION_ROUTES } from './location/location.routes';
import { PATRIMOINE_ROUTES } from './patrimoine/patrimoine.routes';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pilotage/tableau-de-bord').then((m) => m.TableauDeBord), title: 'Tableau de bord' },
  ...PATRIMOINE_ROUTES,
  ...LOCATION_ROUTES,
  { path: 'loyers', loadComponent: () => import('./loyers/loyers').then((m) => m.Loyers), title: 'Loyers' },
  { path: 'parametres', loadComponent: () => import('./parametres/parametres').then((m) => m.Parametres), title: 'Paramètres' },
  { path: '**', redirectTo: '' },
];
