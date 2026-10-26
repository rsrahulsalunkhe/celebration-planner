import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge } from '@/components/Badge.tsx';
import { selectActiveEvent } from '@/domain/selectors.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { EventSwitcher } from './EventSwitcher.tsx';
import { DATA_NAV_ITEM, NAV_ITEMS, type NavItem } from './navigation.ts';
import { usePlannerState } from './state/plannerContext.ts';
import { StorageNotice } from './StorageNotice.tsx';
import styles from './AppShell.module.css';

const MENU_ID = 'app-menu';
const SITE_NAME = 'Celebration Planner';

function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      width="28"
      height="28"
      className={styles.mark}
    >
      <circle cx="16" cy="16" r="16" fill="#e2b34a" />
      <path
        d="M16 6.5l2.5 6 6.5.6-4.9 4.2 1.5 6.4L16 20.4l-5.6 3.3 1.5-6.4L7 13.1l6.5-.6z"
        fill="#14213d"
      />
    </svg>
  );
}

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        isActive ? `${styles.link} ${styles.active}` : styles.link
      }
    >
      <Icon aria-hidden size={20} />
      <span className={styles.linkLabel}>{item.label}</span>
      {item.planned ? <Badge tone="gold">Soon</Badge> : null}
    </NavLink>
  );
}

/**
 * The frame around every page: a navy sidebar on wide screens and a compact
 * bar with a menu button on narrow ones, with the page in `main`.
 */
export function AppShell() {
  const location = useLocation();
  const state = usePlannerState();
  const activeTitle = selectActiveEvent(state)?.profile.title;

  // The menu is "open for" one location, so any navigation closes it without an effect.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const menuOpen = openFor === location.key;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastKey = useRef(location.key);

  // After a page change, name the tab and move the reader to the new heading.
  useEffect(() => {
    const heading = mainRef.current?.querySelector('h1');
    const text = heading?.textContent;
    document.title = text ? `${text} · ${SITE_NAME}` : SITE_NAME;
    if (lastKey.current !== location.key) {
      lastKey.current = location.key;
      (heading ?? mainRef.current)?.focus();
    }
  }, [location.key, activeTitle]);

  const closeMenu = () => {
    setOpenFor(null);
  };

  // Choosing an event on a narrow screen closes the menu, which would drop focus
  // into nothing, so move the reader to the new event's heading. On a wide screen
  // the menu is not open, and focus stays on the select.
  const handleSwitch = () => {
    if (!menuOpen) return;
    closeMenu();
    setTimeout(() => {
      mainRef.current?.querySelector('h1')?.focus();
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && menuOpen) {
      event.stopPropagation();
      closeMenu();
      menuButtonRef.current?.focus();
    }
  };

  return (
    <div className={styles.shell}>
      <a
        className={styles.skipLink}
        href="#main"
        onClick={(event) => {
          // A plain "#main" link would be read by HashRouter as a route change.
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      <div className={styles.sidebar} onKeyDown={handleKeyDown}>
        <header className={styles.bar}>
          <Link to="/" className={styles.brand} onClick={closeMenu}>
            <BrandMark />
            <span>{SITE_NAME}</span>
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            onClick={() => {
              setOpenFor(menuOpen ? null : location.key);
            }}
          >
            {menuOpen ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}
            {menuOpen ? 'Close menu' : 'Menu'}
          </button>
          <p className={styles.currentEvent}>
            <span className={styles.currentLabel}>Event: </span>
            {activeTitle ?? 'none selected'}
          </p>
        </header>

        <aside
          id={MENU_ID}
          className={styles.panel}
          data-open={menuOpen}
          aria-label="Events and navigation"
        >
          <EventSwitcher onNavigate={closeMenu} onSwitch={handleSwitch} />
          <nav aria-label="Main">
            <ul className={styles.nav}>
              {NAV_ITEMS.map((item) => (
                <li key={item.path}>
                  <NavItemLink item={item} onNavigate={closeMenu} />
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles.footer}>
            <NavItemLink item={DATA_NAV_ITEM} onNavigate={closeMenu} />
            <p className={styles.note}>Everything is saved only in this browser.</p>
          </div>
        </aside>
      </div>

      <main id="main" ref={mainRef} className={styles.main} tabIndex={-1}>
        <div className="no-print">
          <StorageNotice />
        </div>
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
