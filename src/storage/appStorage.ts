import * as FileSystem from 'expo-file-system/legacy';

import type { AppState, DailyMoodEntry, Goal, Task } from '../types';
import { formatDateKey } from '../utils/date';

const STORAGE_FILE_NAME = 'sprout-app-state.json';
const storageUri = `${FileSystem.documentDirectory}${STORAGE_FILE_NAME}`;

const normalizeGoal = (goal: Partial<Goal>): Goal => ({
  id: goal.id ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  name: goal.name ?? '',
  currentSteps: Number.isFinite(goal.currentSteps) ? Math.max(goal.currentSteps ?? 0, 0) : 0,
  totalSteps:
    Number.isFinite(goal.totalSteps) && (goal.totalSteps ?? 0) > 0 ? Math.floor(goal.totalSteps ?? 1) : 1,
  createdAt: goal.createdAt ?? new Date().toISOString(),
  archivedAt: goal.archivedAt ?? null,
});

const normalizeTask = (task: Partial<Task>): Task => {
  const createdAt = task.createdAt ?? new Date().toISOString();
  const completedAt = task.completedAt ?? null;
  const lastCompletedAt = task.lastCompletedAt ?? completedAt;

  return {
    id: task.id ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    content: task.content ?? '',
    createdAt,
    updatedAt: task.updatedAt ?? createdAt,
    isCompleted: Boolean(task.isCompleted),
    completedAt,
    recurrence: task.recurrence ?? 'none',
    earnedDrops: Number.isFinite(task.earnedDrops) ? Math.max(task.earnedDrops ?? 0, 0) : 0,
    lastCompletedAt,
  };
};

const normalizeDailyMoodEntry = (entry: Partial<DailyMoodEntry>, dateKey: string): DailyMoodEntry => ({
  date: entry.date ?? dateKey,
  mood: entry.mood ?? 'calm',
  note: entry.note ?? '',
});

const normalizeAppState = (appState: Partial<AppState>): AppState => ({
  goals: (appState.goals ?? []).map(normalizeGoal),
  tasks: (appState.tasks ?? []).map(normalizeTask),
  selectedGoalId: appState.selectedGoalId ?? null,
  dailyMoods: Object.fromEntries(
    Object.entries(appState.dailyMoods ?? {}).map(([dateKey, entry]) => [
      dateKey,
      normalizeDailyMoodEntry(entry ?? {}, dateKey),
    ])
  ),
  waterEvents: appState.waterEvents ?? [],
});

export const loadAppState = async (): Promise<AppState | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(storageUri);

    if (!fileInfo.exists) {
      return null;
    }

    const raw = await FileSystem.readAsStringAsync(storageUri);

    if (!raw) {
      return null;
    }

    return normalizeAppState(JSON.parse(raw) as Partial<AppState>);
  } catch (error) {
    console.warn('Failed to load app state', error);
    return null;
  }
};

export const saveAppState = async (appState: AppState) => {
  try {
    await FileSystem.writeAsStringAsync(storageUri, JSON.stringify(appState));
  } catch (error) {
    console.warn('Failed to save app state', error);
  }
};

export const createEmptyDailyMoodMap = () => ({
  [formatDateKey()]: undefined,
});
