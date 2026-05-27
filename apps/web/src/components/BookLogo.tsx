interface Props {
  size?: number;
  className?: string;
}

export function BookLogo({ size = 48, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 14 Q8 10 12 10 L30 10 Q32 12 32 14 L32 54 Q32 52 30 52 L12 52 Q8 52 8 54 Z"
        fill="var(--sun)"
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M56 14 Q56 10 52 10 L34 10 Q32 12 32 14 L32 54 Q32 52 34 52 L52 52 Q56 52 56 54 Z"
        fill="var(--accent)"
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <line x1="14" y1="22" x2="26" y2="22" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="30" x2="26" y2="30" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="22" x2="50" y2="22" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="30" x2="50" y2="30" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
