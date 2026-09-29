/** The LiteChat mascot: a small blue speech bubble with a face. */
export function Mascot({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="var(--blue)"
        d="M16 3C8.8 3 3 8.2 3 14.6c0 3.6 1.9 6.9 4.9 9l-1.2 5.2 5.6-3.2c1.2.3 2.4.5 3.7.5 7.2 0 13-5.2 13-11.6S23.2 3 16 3Z"
      />
      <circle cx="11.5" cy="14" r="2.2" fill="var(--white)" />
      <circle cx="20.5" cy="14" r="2.2" fill="var(--white)" />
      <circle cx="12" cy="14.4" r="1" fill="var(--dark)" />
      <circle cx="21" cy="14.4" r="1" fill="var(--dark)" />
      <path
        d="M12.8 18.8c.9.8 2 1.3 3.2 1.3s2.3-.5 3.2-1.3"
        stroke="var(--white)"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <Mascot />
      <span className="font-display text-[22px] font-semibold tracking-tight text-lc-dark">
        Lite<span className="text-lc-blue">Chat</span>
      </span>
    </div>
  );
}
