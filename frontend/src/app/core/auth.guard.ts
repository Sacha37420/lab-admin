import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { KeycloakService } from './keycloak.service';

/**
 * Guard : redirige vers /forbidden si l'utilisateur n'a pas le groupe 'admins'.
 * L'utilisateur est forcément authentifié ici (Keycloak init avec login-required).
 * Posé sur chaque page d'administration (Apps du lab, Nouvel utilisateur, Debug).
 */
export const adminGuard: CanActivateFn = () => {
  const kc = inject(KeycloakService);
  const router = inject(Router);
  return kc.isAdmin ? true : router.createUrlTree(['/forbidden']);
};

/**
 * Guard des pages de tout le monde (Accueil, Services, Projets, page d'un projet) : `admins` ou
 * `developers` — les deux groupes que Keycloak laisse entrer (contrat multi-dev, I6). Ce que
 * chaque page montre d'administration y reste conditionné au groupe `admins`.
 */
export const labGuard: CanActivateFn = () => {
  const kc = inject(KeycloakService);
  const router = inject(Router);
  return kc.isAdmin || kc.groups.includes('developers')
    ? true
    : router.createUrlTree(['/forbidden']);
};
