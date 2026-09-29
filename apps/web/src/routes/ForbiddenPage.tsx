import { Link } from 'react-router';
import { BackToSessions } from '../components/BackToSessions';

export function ForbiddenPage() {
  return (
    <div className="flex flex-1 flex-col p-4">
      <BackToSessions />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="font-display text-5xl font-semibold text-lc-light-blue">403</p>
        <h1 className="mt-2 text-xl font-medium">You don't have access to this page</h1>
        <p className="mt-1 max-w-sm text-sm text-lc-grey">Ask a manager to enable it for your account.</p>
        <Link to="/" className="focus-ring mt-5 rounded-md bg-lc-blue px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110">
          Go home
        </Link>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <p className="font-display text-5xl font-semibold text-lc-light-blue">404</p>
      <h1 className="mt-2 text-xl font-medium">Page not found</h1>
      <Link to="/" className="focus-ring mt-5 text-sm text-lc-blue underline">
        Go home
      </Link>
    </div>
  );
}
