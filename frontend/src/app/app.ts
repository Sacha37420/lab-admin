import { Component, ElementRef, HostListener, inject, signal, ViewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { KeycloakService } from './core/keycloak.service';
import { ThemeService } from './core/theme.service';

interface NavItem {
  label: string;
  abbr: string;
  path: string;
  exact?: boolean;
  /** Page réservée au groupe `admins` (adminGuard sur sa route). */
  adminOnly?: boolean;
}

const MOBILE_CLOSE_ANIM_MS = 220;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  protected kc = inject(KeycloakService);
  protected theme = inject(ThemeService);

  collapsed = signal(false);
  mobileOpen = signal(false);
  mobileClosing = signal(false);

  protected noop = (): void => {};
  protected closeMobileFn = (): void => this.closeMobile();

  private readonly allNavItems: NavItem[] = [
    { path: '/',                   label: 'Accueil',           abbr: 'Ac', exact: true },
    { path: '/code',                label: 'Code',               abbr: 'Co', adminOnly: true },
    { path: '/apps-hebergees',      label: 'Apps du lab',        abbr: 'La', adminOnly: true },
    { path: '/outils',              label: 'Outils',             abbr: 'Ou', adminOnly: true },
    { path: '/nouvel-utilisateur',  label: 'Nouvel utilisateur', abbr: 'Nu', adminOnly: true },
    { path: '/debug',               label: 'Debug',              abbr: 'De', adminOnly: true },
  ];

  /** Un développeur non-admin ne voit aucun lien vers une page qui le refuserait. */
  get navItems(): NavItem[] {
    if (this.kc.isAdmin) return this.allNavItems;
    // Pour lui, l'accueil EST « Mes projets ».
    return this.allNavItems.filter(i => !i.adminOnly).map(i => ({ ...i, label: 'Mes projets', abbr: 'Pr' }));
  }

  @ViewChild('closeBtn') private closeBtnRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('burgerBtn') private burgerBtnRef?: ElementRef<HTMLButtonElement>;

  toggleCollapsed(): void {
    this.collapsed.update(v => !v);
  }

  openMobile(): void {
    this.mobileOpen.set(true);
    this.mobileClosing.set(false);
    document.body.style.overflow = 'hidden';
    setTimeout(() => this.closeBtnRef?.nativeElement.focus());
  }

  closeMobile(): void {
    if (!this.mobileOpen() || this.mobileClosing()) return;
    this.mobileClosing.set(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      this.mobileOpen.set(false);
      this.mobileClosing.set(false);
      document.body.style.overflow = '';
      this.burgerBtnRef?.nativeElement.focus();
    }, reduced ? 0 : MOBILE_CLOSE_ANIM_MS);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileOpen()) this.closeMobile();
  }

  get username(): string {
    return this.kc.username || this.kc.email;
  }

  logout(): void {
    this.kc.logout();
  }
}

// Export pour Angular standalone
export { AppComponent as App };
