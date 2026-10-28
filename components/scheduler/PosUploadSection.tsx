import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useT } from '@/contexts/LocaleContext';
import { Colors, brand } from '@/constants/Colors';
import { getSessionToken } from '@/services/authToken';
import { normaliseDateInput } from '@/utils/dateKeys';

// Design tokens (light-mode defaults for static StyleSheet)
const C = Colors.light;
const PRIMARY = brand.primary;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PosUploadSectionProps = {
  accountId: string;
  onUploadComplete?: (rowCount: number) => void;
};

type ParsedRow = {
  date: string;        // normalised YYYY-MM-DD
  revenue: number;
  covers: number | null;
  notes: string | null;
  source: 'upload';
};

type ValidationError = {
  row: number;         // 1-based (after header)
  field: string;
  message: string;
};

type ParseResult =
  | { ok: true; rows: ParsedRow[]; errors: ValidationError[] }
  | { ok: false; fatalError: string };

type UploadState =
  | { stage: 'idle' }
  | { stage: 'preview'; rows: ParsedRow[]; errors: ValidationError[] }
  | { stage: 'uploading' }
  | { stage: 'success'; count: number }
  | { stage: 'error'; message: string };

// ---------------------------------------------------------------------------
// CSV parsing helpers (pure JS, no library)
// ---------------------------------------------------------------------------

const MAX_ROWS = 1000;

/** Strip currency symbols / commas and parse float */
function parseRevenue(raw: string): number | null {
  const cleaned = raw.replace(/[$€£,]/g, '').trim();
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

/**
 * Date of a CSV row as YYYY-MM-DD ("YYYY-MM-DD" or "M/D/YYYY"); impossible days
 * such as 2026-02-31 are rejected (utils/dateKeys.ts, CHG-089).
 */
const normaliseDate = normaliseDateInput;

/** Very simple CSV line splitter (handles quoted fields) */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Parses a POS CSV upload (exported for tests). */
export function parseCsv(text: string): ParseResult {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = rawLines.filter((l) => l.trim() !== '');

  if (lines.length < 2) {
    return { ok: false, fatalError: 'CSV must contain a header row and at least one data row.' };
  }

  const headerCells = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  const dateIdx = headerCells.indexOf('date');
  const revenueIdx = headerCells.indexOf('revenue');

  if (dateIdx === -1) {
    return { ok: false, fatalError: 'Missing required column: "date"' };
  }
  if (revenueIdx === -1) {
    return { ok: false, fatalError: 'Missing required column: "revenue"' };
  }

  const coversIdx = headerCells.indexOf('covers');
  const notesIdx = headerCells.indexOf('notes');

  const dataLines = lines.slice(1);

  if (dataLines.length > MAX_ROWS) {
    return { ok: false, fatalError: `Too many rows. Maximum is ${MAX_ROWS} per upload.` };
  }

  const rows: ParsedRow[] = [];
  const errors: ValidationError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = i + 1; // 1-based
    const cells = splitCsvLine(dataLines[i]);

    // date
    const rawDate = (cells[dateIdx] ?? '').trim();
    const normDate = normaliseDate(rawDate);
    if (!normDate) {
      errors.push({ row: rowNum, field: 'date', message: `Invalid date "${rawDate}"` });
    }

    // revenue
    const rawRevenue = (cells[revenueIdx] ?? '').trim();
    const revenue = parseRevenue(rawRevenue);
    if (revenue === null) {
      errors.push({ row: rowNum, field: 'revenue', message: `Invalid revenue "${rawRevenue}"` });
    } else if (revenue < 0) {
      errors.push({ row: rowNum, field: 'revenue', message: `Revenue cannot be negative (${revenue})` });
    }

    // covers (optional)
    let covers: number | null = null;
    if (coversIdx !== -1) {
      const rawCovers = (cells[coversIdx] ?? '').trim();
      if (rawCovers !== '') {
        const c = parseInt(rawCovers, 10);
        if (isNaN(c) || c < 0) {
          errors.push({ row: rowNum, field: 'covers', message: `Invalid covers "${rawCovers}"` });
        } else {
          covers = c;
        }
      }
    }

    // notes (optional)
    let notes: string | null = null;
    if (notesIdx !== -1) {
      const rawNotes = (cells[notesIdx] ?? '').trim();
      if (rawNotes !== '') {
        if (rawNotes.length > 500) {
          errors.push({ row: rowNum, field: 'notes', message: `Notes too long (${rawNotes.length} chars, max 500)` });
        } else {
          notes = rawNotes;
        }
      }
    }

    if (normDate !== null && revenue !== null && revenue >= 0) {
      rows.push({
        date: normDate,
        revenue,
        covers,
        notes,
        source: 'upload',
      });
    }
  }

  return { ok: true, rows, errors };
}

// ---------------------------------------------------------------------------
// SectionCard helper (inline — avoids importing unknown component)
// ---------------------------------------------------------------------------

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.header}>
        <Text style={cardStyles.title}>{title}</Text>
        {subtitle ? <Text style={cardStyles.subtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
});

// ---------------------------------------------------------------------------
// Preview table
// ---------------------------------------------------------------------------

type PreviewTableProps = {
  rows: ParsedRow[];
};

function PreviewTable({ rows }: PreviewTableProps) {
  const preview = rows.slice(0, 5);
  return (
    <ScrollView horizontal style={previewStyles.scroll}>
      <View>
        {/* Header */}
        <View style={previewStyles.row}>
          {['Date', 'Revenue', 'Covers', 'Notes'].map((h) => (
            <Text key={h} style={[previewStyles.cell, previewStyles.headerCell]}>
              {h}
            </Text>
          ))}
        </View>
        {preview.map((r, i) => (
          <View
            key={i}
            style={[previewStyles.row, i % 2 === 1 && previewStyles.rowAlt]}
          >
            <Text style={previewStyles.cell}>{r.date}</Text>
            <Text style={previewStyles.cell}>{r.revenue.toFixed(2)}</Text>
            <Text style={previewStyles.cell}>{r.covers ?? '—'}</Text>
            <Text style={[previewStyles.cell, previewStyles.notesCell]} numberOfLines={1}>
              {r.notes ?? '—'}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const previewStyles = StyleSheet.create({
  scroll: {
    marginTop: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: C.surface,
  },
  rowAlt: {
    backgroundColor: C.background,
  },
  cell: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 100,
    fontSize: 13,
    color: C.text,
    borderRightWidth: 1,
    borderRightColor: C.border,
  },
  headerCell: {
    fontWeight: '600',
    backgroundColor: PRIMARY + '1A',
    color: C.text,
  },
  notesCell: {
    minWidth: 160,
  },
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PosUploadSection({
  accountId,
  onUploadComplete,
}: PosUploadSectionProps) {
  const { t } = useT();

  const [pasteText, setPasteText] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>({ stage: 'idle' });

  // Web-only hidden file input
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') {
          handleParseCsv(text);
        }
      };
      reader.readAsText(file);
      // reset so same file can be re-selected
      input.value = '';
    });

    document.body.appendChild(input);
    fileInputRef.current = input;

    return () => {
      document.body.removeChild(input);
      fileInputRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleParseCsv = useCallback((text: string) => {
    const result = parseCsv(text);
    if (!result.ok) {
      setUploadState({ stage: 'error', message: result.fatalError });
      return;
    }
    setUploadState({ stage: 'preview', rows: result.rows, errors: result.errors });
  }, []);

  const handleChooseFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) return;
    handleParseCsv(pasteText);
  }, [pasteText, handleParseCsv]);

  const handleUpload = useCallback(async () => {
    if (uploadState.stage !== 'preview') return;
    const { rows } = uploadState;

    setUploadState({ stage: 'uploading' });

    try {
      const token = await getSessionToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/secure-proxy', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'uploadPosSales',
          accountId,
          rows,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        setUploadState({ stage: 'error', message: errBody || String(response.status) });
        return;
      }

      const json = (await response.json()) as { count?: number };
      const count = json.count ?? rows.length;
      setUploadState({ stage: 'success', count });
      setPasteText('');
      onUploadComplete?.(count);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadState({ stage: 'error', message: msg });
    }
  }, [uploadState, accountId, onUploadComplete]);

  const handleReset = useCallback(() => {
    setUploadState({ stage: 'idle' });
    setPasteText('');
  }, []);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderInput = () => {
    if (Platform.OS === 'web') {
      return (
        <View>
          <Text style={styles.label}>{t('scheduler.pos.pasteLabel')}</Text>
          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={6}
            value={pasteText}
            onChangeText={setPasteText}
            placeholder={t('scheduler.pos.pastePlaceholder')}
            placeholderTextColor={C.textSecondary}
            accessibilityLabel={t('scheduler.pos.pasteLabel')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.uploadButton, !pasteText.trim() && styles.uploadButtonDisabled]}
              onPress={handlePasteSubmit}
              disabled={!pasteText.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.uploadButtonText}>
                {t('scheduler.pos.uploadButton')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.uploadButton, { opacity: 0.75 }]}
              onPress={handleChooseFile}
              accessibilityRole="button"
              accessibilityLabel={t('scheduler.pos.uploadButton')}
            >
              <Text style={styles.uploadButtonText}>
                {t('scheduler.pos.uploadButton')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View>
        <Text style={styles.label}>{t('scheduler.pos.pasteLabel')}</Text>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={6}
          value={pasteText}
          onChangeText={setPasteText}
          placeholder={t('scheduler.pos.pastePlaceholder')}
          placeholderTextColor={C.textSecondary}
          accessibilityLabel={t('scheduler.pos.pasteLabel')}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.uploadButton, !pasteText.trim() && styles.uploadButtonDisabled]}
          onPress={handlePasteSubmit}
          disabled={!pasteText.trim()}
          accessibilityRole="button"
        >
          <Text style={styles.uploadButtonText}>
            {t('scheduler.pos.uploadButton')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderPreview = () => {
    if (uploadState.stage !== 'preview') return null;
    const { rows, errors } = uploadState;

    return (
      <View style={styles.previewSection}>
        <Text style={styles.previewTitle}>
          {t('scheduler.pos.previewTitle').replace('{n}', String(rows.length))}
        </Text>

        {errors.length > 0 && (
          <View style={styles.errorBox}>
            <Text style={styles.errorBoxTitle}>
              {t('scheduler.pos.validationErrors').replace('{n}', String(errors.length))}
            </Text>
            {errors.slice(0, 10).map((e, i) => (
              <Text key={i} style={styles.errorItem}>
                {`• Row ${e.row} [${e.field}]: ${e.message}`}
              </Text>
            ))}
            {errors.length > 10 && (
              <Text style={styles.errorItem}>{`…and ${errors.length - 10} more`}</Text>
            )}
          </View>
        )}

        {rows.length > 0 && <PreviewTable rows={rows} />}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            accessibilityRole="button"
          >
            <Text style={styles.resetButtonText}>{t('scheduler.pos.resetButton')}</Text>
          </TouchableOpacity>

          {rows.length > 0 && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleUpload}
              accessibilityRole="button"
            >
              <Text style={styles.actionButtonText}>
                {t('scheduler.pos.uploadAction').replace('{n}', String(rows.length))}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderResult = () => {
    if (uploadState.stage === 'success') {
      return (
        <View style={styles.successBox}>
          <Text style={styles.successText}>
            {t('scheduler.pos.uploadSuccess').replace('{n}', String(uploadState.count))}
          </Text>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            accessibilityRole="button"
          >
            <Text style={styles.resetButtonText}>{t('scheduler.pos.resetButton')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (uploadState.stage === 'error') {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorBoxTitle}>
            {t('scheduler.pos.uploadError').replace('{msg}', uploadState.message)}
          </Text>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            accessibilityRole="button"
          >
            <Text style={styles.resetButtonText}>{t('scheduler.pos.resetButton')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  return (
    <SectionCard
      title={t('scheduler.pos.sectionTitle')}
      subtitle={t('scheduler.pos.sectionSubtitle')}
    >
      <View style={styles.tooltipRow}>
        <Text style={styles.tooltipText}>{t('scheduler.pos.tooltip')}</Text>
      </View>

      {uploadState.stage === 'idle' && renderInput()}

      {uploadState.stage === 'preview' && renderPreview()}

      {uploadState.stage === 'uploading' && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={PRIMARY} />
        </View>
      )}

      {(uploadState.stage === 'success' || uploadState.stage === 'error') &&
        renderResult()}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  tooltipRow: {
    backgroundColor: PRIMARY + '14',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  tooltipText: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: C.text,
    marginBottom: 6,
  },
  textArea: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 120,
    fontSize: 13,
    color: C.text,
    backgroundColor: C.background,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  uploadButton: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  uploadButtonDisabled: {
    opacity: 0.45,
  },
  uploadButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 0,
  },
  previewSection: {
    marginTop: 4,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  errorBox: {
    backgroundColor: brand.error + '18',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: brand.error,
  },
  errorBoxTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: brand.error,
    marginBottom: 4,
  },
  errorItem: {
    fontSize: 12,
    color: brand.error,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  actionButton: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  resetButton: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  resetButtonText: {
    color: C.textSecondary,
    fontWeight: '500',
    fontSize: 14,
  },
  successBox: {
    backgroundColor: brand.success + '18',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: brand.success,
    gap: 10,
  },
  successText: {
    fontSize: 14,
    fontWeight: '600',
    color: brand.success,
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
});