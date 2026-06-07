import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useT, useLang } from '../i18n';
import type { Lang as UiLang } from '../i18n';
import { SettingsCog } from './SettingsCog';
import { BookLogo } from './BookLogo';
import { LANG_FLAG } from '../lang';

const UI_LANGS = ['en', 'sv', 'bg', 'es', 'fr', 'it'] as const satisfies readonly UiLang[];

interface Props {
  children: ReactNode;
  showExit?: boolean;
}

export function Layout({ children, showExit = false }: Props) {
  const t = useT();
  const { lang: uiLang, setLang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === '/';
  const [langOpen, setLangOpen] = useState(false);
  const langPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!langOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [langOpen]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="page">
      <div className="header">
        <Link to="/" className="brand">
          <BookLogo size={44} className="brand-logo" />
          <span className="brand-text">
            <span className="brand-word">
              {Array.from(t('brand.name')).map((ch, i) => (
                <span key={i} className={`brand-letter brand-letter--${i % 3}`}>{ch}</span>
              ))}
            </span>
            <small>{t('brand.tagline')}</small>
          </span>
        </Link>
        <div className="header-actions">
          {showExit && (
            <button
              type="button"
              className="back-btn"
              onClick={goBack}
              aria-label={t('nav.back')}
              title={t('nav.back')}
            >
              <span aria-hidden="true">{'←'}</span> {t('nav.back')}
            </button>
          )}
          <div className="header-row">
            {!onHome && (
              <Link
                to="/"
                className="home-btn"
                aria-label={t('nav.home')}
                title={t('nav.home')}
              >
                <span aria-hidden="true">{'🏠'}</span>
              </Link>
            )}
            <div className="lang-picker" ref={langPickerRef}>
              <button
                type="button"
                className="lang-btn"
                onClick={() => setLangOpen((v) => !v)}
                aria-label={t('settings.language')}
                aria-expanded={langOpen}
                title={t('settings.language')}
              >
                {LANG_FLAG[uiLang]}
              </button>
              {langOpen && (
                <div className="lang-popover" role="dialog" aria-label={t('settings.language')}>
                  {UI_LANGS.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={`lang-popover-item${uiLang === code ? ' on' : ''}`}
                      onClick={() => { setLang(code); setLangOpen(false); }}
                      aria-pressed={uiLang === code}
                    >
                      <span className="lang-popover-flag" aria-hidden="true">{LANG_FLAG[code]}</span>
                      <span>{t(`settings.language${code[0].toUpperCase()}${code[1]}` as 'settings.languageEn')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <SettingsCog />
          </div>
        </div>
      </div>
      {children}
      <div className="footer">
        {t('dedication.line')}{' · '}
        <a href="https://github.com/tom4cam/Story-Maker" target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </div>
    </div>
  );
}
