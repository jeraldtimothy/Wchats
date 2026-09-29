import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Mascot } from '../components/Logo';

/** Shown instead of a blank screen when a page throws while rendering or loading. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (import.meta.env.DEV && !notFound) console.error(error);
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Mascot size={44} />
      <h1 className="text-xl font-medium">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="max-w-sm text-sm text-lc-grey">
        {notFound ? "This page doesn't exist." : 'This page hit an unexpected error. Reloading usually fixes it.'}
      </p>
      <div className="flex gap-2">
        {!notFound && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="focus-ring rounded-md bg-lc-blue px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110"
          >
            Reload
          </button>
        )}
        <Link to="/" className="focus-ring rounded-md border border-lc-border bg-lc-white px-4 py-2 text-sm hover:bg-lc-light">
          Go home
        </Link>
      </div>
    </div>
  );
}
