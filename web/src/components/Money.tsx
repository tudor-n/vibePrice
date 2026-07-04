/**
 * Money display. Formatting only — never compute amounts in the client;
 * the server's numbers are the truth (see root CLAUDE.md hard rules).
 */

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
  }).format(amount);
}

interface MoneyProps {
  amount: number;
  currency: string;
  className?: string;
}

export function Money({ amount, currency, className }: MoneyProps) {
  return (
    <span className={className ? `money ${className}` : 'money'}>
      {formatMoney(amount, currency)}
    </span>
  );
}
