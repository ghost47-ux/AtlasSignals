/**
 * Navbar.tsx — fixed glass nav with mobile menu and auth-aware CTAs.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NAV_LINKS } from '../lib/site';
import Logo from './Logo';

export default function Navbar() {
  const { session } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <>
      <header className={`nav ${scrolled || open ? 'scrolled' : ''}`}>
        <div className="container nav-inner">
          <Link to="/" aria-label="AtlasSignals home" onClick={() => setOpen(false)}>
            <Logo />
          </Link>

          <nav className="nav-links" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <a key={l.label} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>

          <div className="nav-cta">
            {session ? (
              <NavLink
                to="/dashboard"
                className={({ isActive }) => `btn btn-ghost btn-sm ${isActive ? 'btn-primary' : ''}`}
              >
                Dashboard
              </NavLink>
            ) : (
              <>
                <Link to="/auth?mode=login" className="btn btn-ghost btn-sm nav-auth-hide">
                  Sign in
                </Link>
                <Link to="/auth?mode=signup" className="btn btn-primary btn-sm">
                  Get started
                </Link>
              </>
            )}
            <button
              className={`nav-burger ${open ? 'open' : ''}`}
              aria-label="Toggle menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="mobile-menu">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          {session ? (
            <button className="btn btn-primary" onClick={() => go('/dashboard')}>
              Dashboard
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => go('/auth?mode=login')}>
                Sign in
              </button>
              <button className="btn btn-primary" onClick={() => go('/auth?mode=signup')}>
                Get started — free trial
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
