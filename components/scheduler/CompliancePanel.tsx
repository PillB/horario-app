/**
 * Labor-rule findings for the visible roster week, grouped by verdict, each
 * with its message and legal citation. With no business location it shows a
 * single prompt to set one up instead of guessing a jurisdiction.
 */
import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/ThemedText';
import { Colors, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { VERDICT_ORDER, type ComplianceResult } from '@/hooks/useCompliance';
import type { Verdict } from '@/services/labor/types';

/** Findings listed per group before "and N more". */
const MAX_PER_GROUP = 20;

type Props = {
  result: ComplianceResult;
  /** First visible day, 'YYYY-MM-DD'. */
  weekStart: string;
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    panel: { gap: 10, marginBottom: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
    heading: { fontWeight: '600', color: colors.text },
    muted: { color: colors.textSecondary },
    group: { gap: 6 },
    groupHeading: { fontWeight: '700' },
    finding: { gap: 2, paddingLeft: 10, borderLeftWidth: 3 },
    message: { color: colors.text },
    meta: { color: colors.textSecondary, fontSize: 13 },
    citeLink: { color: colors.tintText, fontSize: 13, textDecorationLine: 'underline' },
    button: { alignSelf: 'flex-start', paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  });

const verdictColor = (verdict: Verdict, colors: ThemeColors): string => {
  if (verdict === 'violation') return colors.error;
  if (verdict === 'warning' || verdict === 'refusable') return colors.warning;
  if (verdict === 'premium') return colors.tint;
  return colors.textSecondary;
};

export const CompliancePanel = ({ result, weekStart }: Props) => {
  const { t } = useT();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  if (result.status === 'loading') return null;

  if (result.status === 'no-location') {
    return (
      <View style={styles.panel} testID="compliance-setup-prompt">
        <ThemedText style={styles.heading}>{t('compliance.setupTitle')}</ThemedText>
        <ThemedText style={styles.muted}>{t('compliance.setupBody')}</ThemedText>
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="link"
          accessibilityLabel={t('compliance.setupAction')}
          accessibilityHint={t('compliance.setupActionHint')}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        >
          <ThemedText style={styles.citeLink}>{t('compliance.setupAction')}</ThemedText>
        </Pressable>
      </View>
    );
  }

  const groups = VERDICT_ORDER.filter((v) => result.byVerdict[v].length > 0);

  return (
    <View style={styles.panel} testID="compliance-panel">
      <ThemedText style={styles.heading} accessibilityRole="header">
        {t('compliance.title', { date: weekStart })}
      </ThemedText>
      {groups.length === 0 ? (
        <ThemedText style={styles.muted} testID="compliance-none">{t('compliance.none')}</ThemedText>
      ) : null}
      {result.unlinkedShiftIds.length > 0 ? (
        <ThemedText style={styles.muted} testID="compliance-unlinked">
          {t('compliance.unlinked', { n: String(result.unlinkedShiftIds.length) })}
        </ThemedText>
      ) : null}
      {groups.map((verdict) => {
        const findings = result.byVerdict[verdict];
        const color = verdictColor(verdict, colors);
        return (
          <View key={verdict} style={styles.group} testID={`compliance-group-${verdict}`}>
            <ThemedText style={[styles.groupHeading, { color }]} accessibilityRole="header">
              {t(`compliance.group.${verdict}`, { n: String(findings.length) })}
            </ThemedText>
            {findings.slice(0, MAX_PER_GROUP).map((finding, index) => {
              const who = [finding.workerName, finding.locationName].filter(Boolean).join(' · ');
              const url = finding.cite?.url;
              return (
                <View
                  key={`${finding.rule}-${finding.workerId}-${finding.shiftIds.join(',')}-${index}`}
                  style={[styles.finding, { borderLeftColor: color }]}
                >
                  <ThemedText style={styles.message}>{finding.message}</ThemedText>
                  {who ? <ThemedText style={styles.meta}>{who}</ThemedText> : null}
                  {finding.cite ? (
                    url ? (
                      <Pressable
                        onPress={() => void Linking.openURL(url)}
                        accessibilityRole="link"
                        accessibilityLabel={t('compliance.citeA11y', { source: finding.cite.source })}
                        accessibilityHint={t('compliance.citeHint')}
                      >
                        <ThemedText style={styles.citeLink}>{finding.cite.source}</ThemedText>
                      </Pressable>
                    ) : (
                      <ThemedText style={styles.meta}>{finding.cite.source}</ThemedText>
                    )
                  ) : null}
                </View>
              );
            })}
            {findings.length > MAX_PER_GROUP ? (
              <ThemedText style={styles.meta}>
                {t('compliance.more', { n: String(findings.length - MAX_PER_GROUP) })}
              </ThemedText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};
