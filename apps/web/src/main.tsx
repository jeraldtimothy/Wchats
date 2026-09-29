import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppLayout } from './components/AppLayout';
import { ToastProvider } from './components/Toast';
import './index.css';
import { ChatHome } from './routes/ChatHome';
import { ChatSessionPage } from './routes/ChatSessionPage';
import { NotFoundPage } from './routes/ForbiddenPage';
import { DefaultAppRedirect, RequireFrontend, RequireManager } from './routes/guards';
import { LoginPage } from './routes/LoginPage';
import { PlaceholderPage } from './routes/PlaceholderPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DefaultAppRedirect /> },
      {
        path: 'chat',
        element: (
          <RequireFrontend app="chat">
            <ChatHome />
          </RequireFrontend>
        ),
      },
      {
        path: 'chat/:sessionId',
        element: (
          <RequireFrontend app="chat">
            <ChatSessionPage />
          </RequireFrontend>
        ),
      },
      {
        path: 'ask',
        element: (
          <RequireFrontend app="ask">
            <PlaceholderPage title="Ask" phase={3}>
              Quick one-shot questions to any model, billed the same way as chat.
            </PlaceholderPage>
          </RequireFrontend>
        ),
      },
      {
        path: 'profile',
        element: (
          <PlaceholderPage title="My Profile" phase={2}>
            Your profile, global system prompt, memory items, default app and billing balances.
          </PlaceholderPage>
        ),
      },
      {
        path: 'iam',
        element: (
          <RequireManager>
            <PlaceholderPage title="IAM and Billing" phase={3}>
              Manage users, billing accounts, credit and the model catalog.
            </PlaceholderPage>
          </RequireManager>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
