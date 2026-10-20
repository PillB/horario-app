/**
 * PageTitle — sets the document <title> for a screen on web (WCAG 2.4.2).
 *
 * Expo Router's <Head> is written into the statically rendered HTML and
 * updated on client navigation. On iOS and Android it has no visible effect.
 * Every route under app/ renders one (enforced by PageTitle.test.tsx).
 */
import Head from 'expo-router/head';
import React from 'react';

export const APP_NAME = 'Horario';

export function formatPageTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME;
}

export function PageTitle({ title }: { title: string }): React.JSX.Element {
  return (
    <Head>
      <title>{formatPageTitle(title)}</title>
    </Head>
  );
}
