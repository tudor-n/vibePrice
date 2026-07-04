import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../../api/hooks';
import { UnauthorizedError } from '../../api/client';

function errorMessage(error: unknown): string {
  // The one deliberately Romanian string pair in the app — hotel owners see
  // this daily; the rest of the UI stays English for now.
  if (error instanceof UnauthorizedError) {
    return 'Email sau parolă greșită.';
  }
  return 'Sign-in failed. Please check your connection and try again.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate(
      { email, password },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  }

  return (
    <main className="login-screen">
      <div className="login-card">
        <h1 className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>{' '}
          PricePilot
        </h1>
        <p className="page-intro">
          Sign in to see your prices, competitors and recommendations.
        </p>

        <form className="stacked-form" onSubmit={handleSubmit}>
          <label className="field">
            Email
            <input
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {loginMutation.isError && (
          <p className="state state-error" role="alert">
            {errorMessage(loginMutation.error)}
          </p>
        )}

        {import.meta.env.DEV && (
          <aside className="login-hint">
            <strong>Demo account (dev only):</strong>
            <br />
            Email: <code>demo@pricepilot.local</code>
            <br />
            Password: <code>Demo1234!</code>
          </aside>
        )}
      </div>
    </main>
  );
}
