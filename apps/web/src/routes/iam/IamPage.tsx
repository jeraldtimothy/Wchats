import { useSearchParams } from 'react-router';
import { BackToSessions } from '../../components/BackToSessions';
import { AccountsTab } from './AccountsTab';
import { ModelsTab } from './ModelsTab';
import { UsersTab } from './UsersTab';

const TABS = [
  { id: 'users', label: 'Users', element: <UsersTab /> },
  { id: 'billing', label: 'Billing Accounts', element: <AccountsTab /> },
  { id: 'models', label: 'Models', element: <ModelsTab /> },
] as const;

export function IamPage() {
  const [params, setParams] = useSearchParams();
  const current = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];
  return (
    <div className="flex-1 overflow-y-auto bg-lc-light">
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
        <BackToSessions />
        <h1 className="text-2xl font-medium">IAM and Billing</h1>
        <div role="tablist" aria-label="IAM sections" className="flex gap-1 border-b border-lc-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === current.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm transition ${
                t.id === current.id ? 'border-lc-blue font-medium text-lc-blue' : 'border-transparent text-lc-grey hover:text-lc-dark'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">{current.element}</div>
      </div>
    </div>
  );
}
