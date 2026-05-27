import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { SettingsCog } from './SettingsCog';
import { BookLogo } from './BookLogo';

interface Props {
  children: ReactNode;
  showExit?: boolean;
}

export function Layout({ children, showExit = false }: Props) {
  const t = useT();
  const navigate = useNavigate();

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
            {t('brand.name')}
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
          <SettingsCog />
        </div>
      </div>
      {children}
      <div className="footer">{t('dedication.line')}</div>
    </div>
  );
}
