import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const show = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm shadow-lg ${
              t.tone === 'error' ? 'bg-lc-error text-white' : 'bg-lc-dark text-lc-white'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Copies text and confirms with the standard toast. */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard! 📋');
      } catch {
        toast('Could not copy to the clipboard.', 'error');
      }
    },
    [toast],
  );
}
