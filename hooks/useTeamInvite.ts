import React, { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type InviteMode = 'manager' | 'worker';

export type UseTeamInviteReturn = {
  inviteModalVisible: boolean;
  inviteMode: InviteMode;
  openInviteAsManager: () => void;
  openInviteAsWorker: () => void;
  closeInvite: () => void;
  inviteCode: string | null;
  hasJoinedTeam: boolean;
  refreshInviteState: () => void;
};

const INVITE_CODE_KEY = 'horario.inviteCode';
const TEAM_CODE_KEY = 'horario.teamCode';

export function useTeamInvite(): UseTeamInviteReturn {
  const [inviteModalVisible, setInviteModalVisible] = useState<boolean>(false);
  const [inviteMode, setInviteMode] = useState<InviteMode>('manager');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [hasJoinedTeam, setHasJoinedTeam] = useState<boolean>(false);

  const refreshInviteState = useCallback((): void => {
    AsyncStorage.multiGet([INVITE_CODE_KEY, TEAM_CODE_KEY])
      .then((pairs: readonly [string, string | null][]) => {
        const storedInviteCode = pairs[0][1];
        const storedTeamCode = pairs[1][1];
        setInviteCode(storedInviteCode);
        setHasJoinedTeam(storedTeamCode !== null && storedTeamCode.length > 0);
      })
      .catch(() => {
        setInviteCode(null);
        setHasJoinedTeam(false);
      });
  }, []);

  useEffect(() => {
    refreshInviteState();
  }, [refreshInviteState]);

  const openInviteAsManager = useCallback((): void => {
    setInviteMode('manager');
    setInviteModalVisible(true);
  }, []);

  const openInviteAsWorker = useCallback((): void => {
    setInviteMode('worker');
    setInviteModalVisible(true);
  }, []);

  const closeInvite = useCallback((): void => {
    setInviteModalVisible(false);
    refreshInviteState();
  }, [refreshInviteState]);

  return {
    inviteModalVisible,
    inviteMode,
    openInviteAsManager,
    openInviteAsWorker,
    closeInvite,
    inviteCode,
    hasJoinedTeam,
    refreshInviteState,
  };
}