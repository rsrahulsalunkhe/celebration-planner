import { PartyPopper } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { NAV_ITEMS } from './navigation.ts';
import styles from './AppShell.module.css';

export function AppShell() {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.inner}>
          <p className={styles.brand}>
            <PartyPopper aria-hidden size={22} />
            Celebration Planner
          </p>
          <nav aria-label="Main">
            <ul className={styles.nav}>
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
                <li key={path}>
                  <NavLink
                    to={path}
                    className={({ isActive }) =>
                      isActive ? `${styles.link} ${styles.active}` : styles.link
                    }
                  >
                    <Icon aria-hidden size={18} />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
