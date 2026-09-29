# Web app

Code: `apps/web/src`. React 19 + Vite, React Router (library mode), TanStack Query, Tailwind v4.

## Routing (`main.tsx`)

`/login` is public. Everything else renders inside `AppLayout`, which loads `/api/me`: a 401 redirects to `/login`, and a disabled account shows a sign-out screen.

| Path | Page | Guard |
|---|---|---|
| `/` | redirect to `profile.defaultApp` (SimGen is external, so it falls back to chat or ask) | |
| `/chat` | `ChatHome` (dashed "+" tile: "Start a New Conversation") | chat |
| `/chat/:sessionId` | `ChatSessionPage` | chat |
| `/profile` | `ProfilePage` ([profile and memories](profile-and-memories.md)) | |
| `/ask`, `/iam` | `PlaceholderPage` (phase 3) | ask / manager |

Guards (`routes/guards.tsx`) render the 403 page when access is missing; the API enforces the same rules.

## Layout

`Sidebar`: logo + logout; APPS (SimGen ↗ external, Ask, CHAT, shown per `allowedFrontends`); ACCOUNT (My Profile; IAM and Billing for managers); SESSIONS ("+" opens the picker; rows show title and date, the active row has a left accent bar, and hover shows rename (inline) and delete (confirm dialog)). On phones (< 768 px) `/chat` shows the sidebar full-screen and other routes show the main area with "Back to sessions".

## Model picker (`components/ModelPicker.tsx`)

A native `<dialog>` titled "Select a Model", with a billing account select and its helper text. Cards view: provider headings with badges, cards with name, description and tier pill. Compact view: a sortable Provider/Model/Tier table with favorite stars (optimistic; favorites always first). The chosen view is remembered in `localStorage`. Picking a model POSTs a session and navigates to it.

## Chat (`components/chat/`)

- `useSessionStream`: an `EventSource` on `/listen`. `snapshot` replaces the in-flight state and refetches the session; deltas apply only if `seq` is newer; `done`/`error` clear the state and refetch the session and `/me` (balance); `session.updated` patches the cached title.
- `MessageList`: user bubbles (right, light blue, plain text, with image thumbnails and file chips above) and assistant bubbles (left, grey, Markdown, with web sources as numbered chips below). Each has a copy button with the toast "Copied to clipboard! 📋". It shows "Thinking…" or web-search activity while waiting, inline errors for refused, truncated and error replies and for insufficient credit (402 on send), and a "Scroll to bottom" button when scrolled up.
- `Markdown`: `lib/markdown.ts` runs marked (GFM) with raw HTML escaped, highlight.js code blocks with a Copy button, then DOMPurify. Links open in a new tab.
- `Composer`: model pill, Include Memories switch (saved on the session), Tools popover (Web Search; "Allow multiple turns" with its hint when the model supports it), thinking-effort select (only if the model has efforts); paperclip, paste and drag-and-drop attachments with upload chips ([attachments](attachments.md)); Enter sends, Shift+Enter adds a newline; files-only messages are allowed.
- A retired model shows the banner with "Start a new chat" and hides the composer.

## Theme

`index.css` defines the spec's CSS variables and maps them to Tailwind tokens (`bg-lc-blue`, `text-lc-dark`, `border-lc-border`, `bg-lc-user-bg`, …), radii 4/8/12, soft shadows, and the fonts (Fredoka for display, Inter for body, Helvetica Neue in `.section-label`).
