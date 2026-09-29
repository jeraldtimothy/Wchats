import { memo, useMemo, type MouseEvent } from 'react';
import { renderMarkdown } from '../../lib/markdown';
import { useCopy } from '../Toast';

/** Sanitized Markdown. Code-block copy buttons are handled by delegation. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const copy = useCopy();

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const button = (e.target as HTMLElement).closest('[data-copy-code]');
    if (!button) return;
    const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    void copy(code);
  }

  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
