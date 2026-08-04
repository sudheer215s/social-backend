'use client';

/**
 * A degraded timeline is still a usable timeline: this names what is stale and
 * never blocks the screen.
 * @see docs/frontend/04-modules/feature-modules.md — `timeline`
 */
import { useEffect, useState } from 'react';
import { subscribeDegraded } from '@/data/degradation';

const MESSAGES: Record<string, string> = {
  'timeline-pull': 'Some posts may be missing.',
  'post-hydration': "Some posts couldn't be loaded.",
};

const GENERIC = 'Some information may be out of date.';

function messageFor(scope: string): string {
  return MESSAGES[scope] ?? GENERIC;
}

export function DegradedBanner() {
  const [scopes, setScopes] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(
    () =>
      subscribeDegraded((next) => {
        setScopes((current) => [...new Set([...current, ...next])]);
      }),
    [],
  );

  const visible = scopes.filter((s) => !dismissed.includes(s));
  if (visible.length === 0) return null;

  const messages = [...new Set(visible.map(messageFor))];

  return (
    <div
      role="status"
      data-testid="degraded-banner"
      className="flex items-start justify-between gap-3 border-b border-border bg-bg-subtle px-4 py-2 text-sm text-fg"
    >
      <div className="space-y-0.5">
        {messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
      <button
        type="button"
        className="min-h-tap min-w-tap shrink-0 text-fg-muted underline"
        onClick={() => {
          setDismissed((current) => [...new Set([...current, ...visible])]);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
