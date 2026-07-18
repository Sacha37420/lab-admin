import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { KeycloakService } from './keycloak.service';

/**
 * Guard : redirige vers /forbidden si l'utilisateur n'a pas le groupe 'admins'.
 * L'utilisateur est forcément authentifié ici (Keycloak init avec login-required).
 */
export const adminGuard: CanActivateFn = () => {
  const kc = inject(KeycloakService);
  const router = inject(Router);
  return kc.groups.includes('admins') ? true : router.createUrlTree(['/forbidden']);
};
