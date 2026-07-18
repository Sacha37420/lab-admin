import { Component, inject } from '@angular/core';
import { KeycloakService } from '../../core/keycloak.service';

@Component({
  selector: 'app-forbidden',
  standalone: true,
  templateUrl: './forbidden.component.html',
})
export class ForbiddenComponent {
  protected kc = inject(KeycloakService);
}
