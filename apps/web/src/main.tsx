import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppLayout } from './components/AppLayout';
import { ToastProvider } from './components/Toast';
import 'highlight.js/styles/github.css';
import './index.css';
import { ChatHome } from './routes/ChatHome';
import { ChatSessionPage } from './routes/ChatSessionPage';
import { NotFoundPage } from './routes/ForbiddenPage';
import { DefaultAppRedirect, RequireFrontend, RequireManager } from './routes/guards';
import { IamPage } from './routes/iam/IamPage';
import { LoginPage } from './routes/LoginPage';
import { RouteError } from './routes/RouteError';
import { ProfilePage } from './routes/ProfilePage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      {
        // Errors inside a page keep the sidebar; errors in the layout itself use the outer boundary.
        errorElement: <RouteError />,
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
          { path: 'profile', element: <ProfilePage /> },
          {
            path: 'iam',
            element: (
              <RequireManager>
                <IamPage />
              </RequireManager>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
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
