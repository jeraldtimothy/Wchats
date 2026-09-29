import { BackToSessions } from '../components/BackToSessions';

/** Pages that exist in the navigation but ship in a later phase. */
export function PlaceholderPage({ title, phase, children }: { title: string; phase: number; children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <BackToSessions />
      <div className="mx-auto mt-2 max-w-2xl rounded-lg border border-lc-border bg-lc-white p-6 shadow-sm">
        <div className="section-label">Coming in phase {phase}</div>
        <h1 className="mt-1 text-2xl font-medium">{title}</h1>
        <p className="mt-2 text-sm text-lc-grey">{children}</p>
      </div>
    </div>
  );
}
