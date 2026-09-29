import type { Tier } from '@wchats/shared';

const STYLES: Record<Tier, string> = {
  value: 'bg-lc-assistant-bg text-lc-grey',
  standard: 'bg-lc-primary-light text-lc-blue',
  premium: 'bg-lc-blue text-white',
};

export function TierPill({ tier }: { tier: Tier }) {
  return (
    <span className={`section-label inline-block rounded-full px-2 py-0.5 !text-[10px] ${STYLES[tier]}`}>
      {tier} tier
    </span>
  );
}
