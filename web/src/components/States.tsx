/**
 * Tiny shared loading / error / empty state blocks so every page
 * handles all three without repeating markup.
 */

export function LoadingState({ what = 'data' }: { what?: string }) {
  return (
    <p className="state state-loading" role="status">
      Loading {what}…
    </p>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p className="state state-error" role="alert">
      Could not load data. {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="state state-empty">{message}</p>;
}
