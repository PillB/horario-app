/**
 * A card the person chose to hide on this device (CHG-105). Gamification at
 * work helps when people opt in and backfires when imposed (Mollick &
 * Rothbard), so the habit and milestone cards can be put away. It is a
 * per-device convenience: if storage fails, the card simply shows.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY_PREFIX = 'horario:hiddenCard:';

export function useHiddenCard(cardId: string) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY_PREFIX + cardId)
      .then((value) => { if (alive) setHidden(value === '1'); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [cardId]);

  const setCardHidden = useCallback((next: boolean) => {
    setHidden(next);
    const write = next ? AsyncStorage.setItem(KEY_PREFIX + cardId, '1') : AsyncStorage.removeItem(KEY_PREFIX + cardId);
    void write.catch(() => undefined);
  }, [cardId]);

  return { hidden, setHidden: setCardHidden } as const;
}
