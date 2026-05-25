import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { SettingsCog } from './SettingsCog';

interface Props {
  children: ReactNode;
  showExit?: boolean;
}

export function Layout({ children, showExit = false }: Props) {
  const t = useT();
  return (
    <div className="page">
      <div className="header">
        {showExit && (
          <Link to="/" className="exit-btn" aria-label={t('story.backHome')} title={t('story.backHome')}>
            {'×'}
          </Link>
        )}
        <Link to="/" className="brand">
          {t('brand.name')}
          <small>{t('brand.tagline')}</small>
        </Link>
        <SettingsCog />
      </div>
      {children}
      <div className="footer">{t('dedication.line')}</div>
    </div>
  );
}
