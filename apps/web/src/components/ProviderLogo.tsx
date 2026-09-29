import type { Provider } from '@wchats/shared';

/** Simple, recognisable provider badges (not the official marks). */
export function ProviderLogo({ provider, size = 22 }: { provider: Provider; size?: number }) {
  if (provider === 'openai') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#061820" />
        <g fill="none" stroke="#fefefe" strokeWidth="1.5">
          <ellipse cx="12" cy="12" rx="6.5" ry="3" />
          <ellipse cx="12" cy="12" rx="6.5" ry="3" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="6.5" ry="3" transform="rotate(120 12 12)" />
        </g>
      </svg>
    );
  }
  if (provider === 'anthropic') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#d97757" />
        <path d="M7 18 11 6h2l4 12h-2.3l-.9-2.8H10.2L9.3 18Zm3.8-4.7h2.4L12 9.5Z" fill="#fefefe" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset="0.5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="#fefefe" stroke="rgba(140,159,167,0.3)" />
      <path d="M12 4c.6 4.3 3.7 7.4 8 8-4.3.6-7.4 3.7-8 8-.6-4.3-3.7-7.4-8-8 4.3-.6 7.4-3.7 8-8Z" fill="url(#gem)" />
    </svg>
  );
}
