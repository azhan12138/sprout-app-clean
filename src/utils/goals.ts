import type { AppState, Goal, Task, TaskRecurrence, WaterEvent } from '../types';
import { formatDateKey } from './date';

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const getWeekKey = (date = new Date()) => {
  const target = new Date(date);
  const day = target.getDay() || 7;
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + 4 - day);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const weekNumber = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${target.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
};

export const getTaskPeriodKey = (recurrence: TaskRecurrence, date = new Date()) => {
  if (recurrence === 'daily') {
    return formatDateKey(date);
  }

  if (recurrence === 'weekly') {
    return getWeekKey(date);
  }

  return null;
};

export const isTaskCompleteForToday = (task: Task, today = new Date()) => {
  if (task.recurrence === 'none') {
    return task.isCompleted;
  }

  if (!task.lastCompletedAt) {
    return false;
  }

  return getTaskPeriodKey(task.recurrence, new Date(task.lastCompletedAt)) === getTaskPeriodKey(task.recurrence, today);
};

export const createGoal = (name: string, totalSteps: number): Goal => ({
  id: createId(),
  name,
  currentSteps: 0,
  totalSteps,
  createdAt: new Date().toISOString(),
  archivedAt: null,
});

export const createTask = (content: string, recurrence: TaskRecurrence = 'none'): Task => ({
  id: createId(),
  content,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isCompleted: false,
  completedAt: null,
  recurrence,
  earnedDrops: 0,
  lastCompletedAt: null,
});

export const createWaterEvent = (goal: Goal): WaterEvent => ({
  id: createId(),
  goalId: goal.id,
  goalNameSnapshot: goal.name,
  amount: 1,
  createdAt: new Date().toISOString(),
});

export const getGoalProgress = (goal: Goal) => {
  if (goal.totalSteps <= 0) {
    return 0;
  }

  return Math.min(goal.currentSteps / goal.totalSteps, 1);
};

export const getPlantStage = (goal: Goal) => {
  const progress = getGoalProgress(goal);

  if (progress >= 1) {
    return { emoji: '🌼', label: '开花' };
  }

  if (progress > 0.5) {
    return { emoji: '🌿', label: '抽叶' };
  }

  if (progress > 0.25) {
    return { emoji: '🌱', label: '破土' };
  }

  return { emoji: '🫘', label: '种子' };
};

export const getWaterDrops = (appState: AppState) => {
  const earnedWaterDrops = appState.tasks.reduce((sum, task) => sum + task.earnedDrops, 0);
  const usedWaterDrops = appState.waterEvents.length > 0
    ? appState.waterEvents.reduce((sum, event) => sum + Math.max(event.amount, 0), 0)
    : appState.goals.reduce((sum, goal) => sum + goal.currentSteps, 0);

  return Math.max(earnedWaterDrops - usedWaterDrops, 0);
};
