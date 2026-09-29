import { Link } from 'react-router';
import { ChevronLeftIcon } from './icons';

/** Phone-only link back to the sessions list. */
export function BackToSessions() {
  return (
    <Link to="/chat" className="focus-ring inline-flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-lc-blue md:hidden">
      <ChevronLeftIcon size={16} /> Back to sessions
    </Link>
  );
}
