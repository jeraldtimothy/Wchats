import { usePicker } from '../lib/picker';
import { PlusIcon } from '../components/icons';

/** Empty state: nothing selected yet. */
export function ChatHome() {
  const { openPicker } = usePicker();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <button
        type="button"
        onClick={openPicker}
        className="focus-ring group flex flex-col items-center gap-4 rounded-lg p-6 text-lc-grey"
      >
        <span className="flex h-28 w-28 items-center justify-center rounded-lg border-2 border-dashed border-lc-light-blue bg-lc-white text-lc-blue transition group-hover:border-lc-blue group-hover:shadow-md">
          <PlusIcon size={36} strokeWidth={1.5} />
        </span>
        <span className="font-display text-lg text-lc-dark">Start a New Conversation</span>
      </button>
    </div>
  );
}
