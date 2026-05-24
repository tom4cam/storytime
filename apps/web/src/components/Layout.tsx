import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <div className="header">
        <Link to="/" className="brand">
          Brennan's Story Maker
          <small>Tell a story. Hear it. Watch it.</small>
        </Link>
      </div>
      {children}
      <div className="footer">
        Made by Tom Caswell, for Brennan.
      </div>
    </div>
  );
}
