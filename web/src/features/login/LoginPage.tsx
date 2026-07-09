import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../../api/hooks';
import { UnauthorizedError } from '../../api/client';
import { Townscape } from '../../components/Townscape';
import { HandUnderline, LogoMark } from '../../components/icons';

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
        <section className="login-hero">
          <div className="login-hero-art" aria-hidden="true">
            {/* The only animated surface in the app: clouds drift, birds fly.
                Data screens stay still by design; reduced-motion disables this. */}
            <Townscape animated />
            <div className="login-hero-shade" />
          </div>
          <p className="login-hero-brand">
            <span className="brand-mark" aria-hidden="true">
              <LogoMark size={30} />
            </span>
            PricePilot
          </p>
          <div className="login-hero-tagline">
            <p className="login-tagline-title">
              Prices your whole street can’t argue with.
            </p>
            <p className="login-tagline-sub">
              Nearby hotel rates, local events and demand — read for you
              every morning, before your first coffee.
            </p>
          </div>
        </section>

        <section className="login-form-panel">
          <h1 className="login-title">Welcome back</h1>
          <HandUnderline width={146} />
          <p className="page-intro">
            Sign in to see your prices, nearby hotels and what&apos;s coming up.
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
        </section>
      </div>
    </main>
  );
}
