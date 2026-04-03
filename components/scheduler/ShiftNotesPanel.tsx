import React, { useState, useCallback, useEffect } from 'react';
import { View, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'done' | 'blocked' | 'delayed';

export type TaskComment = {
  id: string;
  text: string;
  /** ISO timestamp */
  createdAt: string;
};

export type ShiftTask = {
  id: string;
  text: string;
  status: TaskStatus;
  /** ISO timestamp of last status change */
  statusChangedAt?: string;
  comments: TaskComment[];
};

export type ShiftNotesData = {
  managerNote: string;
  tasks: ShiftTask[];
};

export type ShiftNotesPanelProps = {
  shiftId: string;
  workerName: string;
  templateName: string;
  date: string;
  onClose: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: '#475569',
  done: '#15803D',
  blocked: '#DC2626',
  delayed: '#D97706',
};

const STATUS_ICONS: Record<TaskStatus, string> = {
  todo: '○',
  done: '✓',
  blocked: '✗',
  delayed: '⏳',
};

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: 'done',
  done: 'blocked',
  blocked: 'delayed',
  delayed: 'todo',
};

const MANAGER_NOTE_MAX = 500;
const STORAGE_PREFIX = '@horario:shiftNotes:';

function storageKey(shiftId: string) {
  return `${STORAGE_PREFIX}${shiftId}`;
}

function now(): string {
  return new Date().toISOString();
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShiftNotesPanel({
  shiftId,
  workerName,
  templateName,
  date,
  onClose,
}: ShiftNotesPanelProps): React.JSX.Element {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const theme: ThemeColors = Colors[colorScheme ?? 'light'];

  const [managerNote, setManagerNote] = useState<string>('');
  const [tasks, setTasks] = useState<ShiftTask[]>([]);
  const [newTaskText, setNewTaskText] = useState<string>('');
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  // ── Load from AsyncStorage on mount ──────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(storageKey(shiftId))
      .then((raw) => {
        if (raw) {
          try {
            const data = JSON.parse(raw) as ShiftNotesData;
            setManagerNote(data.managerNote ?? '');
            setTasks(data.tasks ?? []);
          } catch {
            // malformed — start fresh
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [shiftId]);

  // ── Auto-save to AsyncStorage on every change ─────────────────────────────

  useEffect(() => {
    if (!loaded) return;
    const data: ShiftNotesData = { managerNote, tasks };
    AsyncStorage.setItem(storageKey(shiftId), JSON.stringify(data)).catch(() => undefined);
  }, [shiftId, managerNote, tasks, loaded]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleManagerNoteChange = useCallback((text: string) => {
    if (text.length <= MANAGER_NOTE_MAX) setManagerNote(text);
  }, []);

  const handleAddTask = useCallback(() => {
    const trimmed = newTaskText.trim();
    if (!trimmed) return;
    const newTask: ShiftTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: trimmed,
      status: 'todo',
      statusChangedAt: now(),
      comments: [],
    };
    setTasks((prev) => [...prev, newTask]);
    setNewTaskText('');
  }, [newTaskText]);

  const handleCycleStatus = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: STATUS_CYCLE[task.status], statusChangedAt: now() }
          : task
      )
    );
  }, []);

  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    setCommentInputs((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  const handleAddComment = useCallback((taskId: string) => {
    const text = (commentInputs[taskId] ?? '').trim();
    if (!text) return;
    const comment: TaskComment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      createdAt: now(),
    };
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, comments: [...task.comments, comment] }
          : task
      )
    );
    setCommentInputs((prev) => ({ ...prev, [taskId]: '' }));
  }, [commentInputs]);

  const handleDeleteComment = useCallback((taskId: string, commentId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, comments: task.comments.filter((c) => c.id !== commentId) }
          : task
      )
    );
  }, []);

  // ─ Derived ─────────────────────────────────────────────────────────────────

  const taskCountByStatus = tasks.reduce<Record<TaskStatus, number>>(
    (acc, task) => ({ ...acc, [task.status]: (acc[task.status] ?? 0) + 1 }),
    { todo: 0, done: 0, blocked: 0, delayed: 0 },
  );

  const inputStyle = [
    styles.textInput,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface },
  ];

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            {templateName} — {workerName}
          </ThemedText>
          <ThemedText style={[styles.mutedText, { color: theme.textTertiary }]}>
            {date}
          </ThemedText>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('shiftNotes.doneBtn')}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressedOpacity]}
        >
          <ThemedText style={styles.closeButtonText}>✕ {t('shiftNotes.doneBtn')}</ThemedText>
        </Pressable>
      </View>

      {/* ── Task summary strip ─────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <View style={styles.summaryStrip}>
          {(Object.entries(taskCountByStatus) as [TaskStatus, number][])
            .filter(([, count]) => count > 0)
            .map(([status, count]) => (
              <View key={status} style={[styles.summaryChip, { backgroundColor: STATUS_COLORS[status] + '22' }]}>
                <ThemedText style={[styles.summaryChipText, { color: STATUS_COLORS[status] }]}>
                  {STATUS_ICONS[status]} {count}
                </ThemedText>
              </View>
            ))}
        </View>
      )}

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Manager Note ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel}>
            {t('shiftNotes.managerNote')}
          </ThemedText>
          <TextInput
            style={[inputStyle, styles.managerNoteInput]}
            value={managerNote}
            onChangeText={handleManagerNoteChange}
            placeholder={t('shiftNotes.managerNotePlaceholder')}
            placeholderTextColor={theme.textTertiary}
            multiline
            numberOfLines={4}
            maxLength={MANAGER_NOTE_MAX}
            textAlignVertical="top"
            accessibilityLabel={t('shiftNotes.managerNote')}
          />
          <ThemedText style={[styles.charCounter, { color: theme.textTertiary }]}>
            {managerNote.length}/{MANAGER_NOTE_MAX}
          </ThemedText>
        </View>

        {/* ── Tasks ──────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel}>
            {t('shiftNotes.tasks')}
          </ThemedText>
          <ThemedText style={[styles.mutedText, { color: theme.textTertiary }]}>
            {t('shiftNotes.tasksDesc')}
          </ThemedText>

          {/* Add Task Row */}
          <View style={styles.addTaskRow}>
            <TextInput
              style={[inputStyle, styles.addTaskInput]}
              value={newTaskText}
              onChangeText={setNewTaskText}
              placeholder={t('shiftNotes.addTaskPlaceholder')}
              placeholderTextColor={theme.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleAddTask}
              accessibilityLabel={t('shiftNotes.addTaskPlaceholder')}
            />
            <Pressable
              onPress={handleAddTask}
              accessibilityRole="button"
              accessibilityLabel={t('shiftNotes.addTaskBtn')}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: brand.primary },
                pressed && styles.pressedOpacity,
              ]}
            >
              <ThemedText style={styles.addButtonText}>
                {t('shiftNotes.addTaskBtn')}
              </ThemedText>
            </Pressable>
          </View>

          {/* Task List */}
          {tasks.length === 0 ? (
            <ThemedText style={[styles.mutedText, styles.emptyState, { color: theme.textTertiary }]}>
              {t('shiftNotes.noTasks')}
            </ThemedText>
          ) : (
            <View style={styles.taskList}>
              {tasks.map((task) => (
                <View
                  key={task.id}
                  style={[
                    styles.taskCard,
                    { borderColor: theme.border ?? '#CBD5E1', backgroundColor: theme.surface },
                  ]}
                >
                  {/* Status row + delete */}
                  <View style={styles.taskTopRow}>
                    <Pressable
                      onPress={() => handleCycleStatus(task.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('shiftNotes.cycleStatus')}
                      style={({ pressed }) => [
                        styles.statusChip,
                        { backgroundColor: STATUS_COLORS[task.status] },
                        pressed && styles.pressedOpacity,
                      ]}
                    >
                      <ThemedText style={styles.statusChipText}>
                        {STATUS_ICONS[task.status]}{' '}
                        {({
                          todo: t('shiftNotes.status.todo'),
                          done: t('shiftNotes.status.done'),
                          blocked: t('shiftNotes.status.blocked'),
                          delayed: t('shiftNotes.status.delayed'),
                        } as Record<TaskStatus, string>)[task.status]}
                      </ThemedText>
                    </Pressable>
                    {task.statusChangedAt && (
                      <ThemedText style={[styles.timestampText, { color: theme.textTertiary }]}>
                        {formatTimestamp(task.statusChangedAt)}
                      </ThemedText>
                    )}
                    <Pressable
                      onPress={() => handleDeleteTask(task.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('shiftNotes.removeTask')}
                      style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedOpacity]}
                    >
                      <ThemedText style={styles.deleteButtonText}>×</ThemedText>
                    </Pressable>
                  </View>

                  {/* Task text */}
                  <ThemedText style={[styles.taskText, task.status === 'done' && styles.strikeThrough]}>
                    {task.text}
                  </ThemedText>

                  {/* ── Comment thread ─────────────────────────────── */}
                  {task.comments.length > 0 && (
                    <View style={[styles.commentThread, { borderLeftColor: STATUS_COLORS[task.status] }]}>
                      {task.comments.map((comment) => (
                        <View key={comment.id} style={styles.commentRow}>
                          <View style={styles.commentBody}>
                            <ThemedText style={styles.commentText}>{comment.text}</ThemedText>
                            <ThemedText style={[styles.timestampText, { color: theme.textTertiary }]}>
                              {formatTimestamp(comment.createdAt)}
                            </ThemedText>
                          </View>
                          <Pressable
                            onPress={() => handleDeleteComment(task.id, comment.id)}
                            accessibilityRole="button"
                            accessibilityLabel={t('shiftNotes.deleteComment')}
                            style={({ pressed }) => [styles.deleteCommentBtn, pressed && styles.pressedOpacity]}
                          >
                            <ThemedText style={[styles.deleteCommentText, { color: theme.textTertiary }]}>×</ThemedText>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Add comment input */}
                  <View style={styles.addCommentRow}>
                    <TextInput
                      style={[inputStyle, styles.commentInput]}
                      value={commentInputs[task.id] ?? ''}
                      onChangeText={(text) =>
                        setCommentInputs((prev) => ({ ...prev, [task.id]: text }))
                      }
                      placeholder={t('shiftNotes.commentPlaceholder')}
                      placeholderTextColor={theme.textTertiary}
                      returnKeyType="send"
                      onSubmitEditing={() => handleAddComment(task.id)}
                      accessibilityLabel={t('shiftNotes.commentPlaceholder')}
                    />
                    <Pressable
                      onPress={() => handleAddComment(task.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('shiftNotes.addCommentBtn')}
                      style={({ pressed }) => [
                        styles.sendCommentBtn,
                        { borderColor: brand.primary },
                        pressed && styles.pressedOpacity,
                      ]}
                    >
                      <ThemedText style={[styles.sendCommentText, { color: brand.primary }]}>↑</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Done Button ─────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('shiftNotes.doneBtn')}
          style={({ pressed }) => [
            styles.doneButton,
            { backgroundColor: brand.primary },
            pressed && styles.pressedOpacity,
          ]}
        >
          <ThemedText style={styles.doneButtonText}>
            {t('shiftNotes.doneBtn')}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
  },
  headerTextGroup: {
    flex: 1,
    marginRight: 12,
    gap: 2,
  },
  headerTitle: {
    flexShrink: 1,
  },
  mutedText: {
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Summary strip
  summaryStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
  },
  summaryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  summaryChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 24,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  managerNoteInput: {
    minHeight: 96,
    paddingTop: 10,
  },
  charCounter: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: -4,
  },
  addTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  addTaskInput: {
    flex: 1,
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyState: {
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  taskList: {
    gap: 10,
    marginTop: 4,
  },
  taskCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  taskTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  statusChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  timestampText: {
    fontSize: 11,
    flex: 1,
  },
  taskText: {
    fontSize: 14,
    lineHeight: 20,
  },
  strikeThrough: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  // Comment thread
  commentThread: {
    borderLeftWidth: 2,
    paddingLeft: 10,
    gap: 6,
    marginTop: 2,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentText: {
    fontSize: 13,
    lineHeight: 18,
  },
  deleteCommentBtn: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCommentText: {
    fontSize: 14,
    fontWeight: '300',
  },
  // Add comment
  addCommentRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  commentInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 6,
  },
  sendCommentBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCommentText: {
    fontSize: 16,
    fontWeight: '700',
  },
  deleteButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  deleteButtonText: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '400',
    opacity: 0.6,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CBD5E1',
  },
  doneButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  pressedOpacity: {
    opacity: 0.65,
  },
});
