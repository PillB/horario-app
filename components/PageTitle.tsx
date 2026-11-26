/**
 * PageTitle — sets the document <title> for a screen on web (WCAG 2.4.2).
 *
 * Expo Router's <Head> is written into the statically rendered HTML and
 * updated on client navigation. On iOS and Android it has no visible effect.
 * Every route under app/ renders one (enforced by PageTitle.test.tsx).
 *
 * Tabs stay mounted, and <Head> only writes the title when a screen mounts or
 * its title changes, so returning to a tab that was already open kept the
 * title of the last tab mounted (F-1, CHG-109). The screen also writes the
 * title itself each time it gains focus. Outside a navigator (tests, a screen
 * rendered alone) there is no focus to follow and only <Head> applies.
 */
import { NavigationContext } from '@react-navigation/native';
import Head from 'expo-router/head';
import React, { useContext, useEffect } from 'react';

export const APP_NAME = 'Horario';

export function formatPageTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME;
}

/** Writes `title` to the document whenever the screen of `navigation` is focused. */
export function useDocumentTitleOnFocus(title: string): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation || typeof document === 'undefined') return undefined;
    const apply = () => {
      document.title = title;
    };
    if (navigation.isFocused()) apply();
    return navigation.addListener('focus', apply);
  }, [navigation, title]);
}

export function PageTitle({ title }: { title: string }): React.JSX.Element {
  const formatted = formatPageTitle(title);
  useDocumentTitleOnFocus(formatted);
  return (
    <Head>
      <title>{formatted}</title>
    </Head>
  );
}
