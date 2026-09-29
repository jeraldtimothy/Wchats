import { useParams } from 'react-router';

export function ChatSessionPage() {
  const { sessionId } = useParams();
  return <div className="p-6 text-sm text-lc-grey">Session {sessionId}</div>;
}
