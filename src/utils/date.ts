import type { Task, WaterEvent } from '../types';

const pad = (value: number) => value.toString().padStart(2, '0');

export const formatDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return `${year}-${month}-${day}`;
};

export const formatDisplayDate = (dateKey: string) => dateKey.replace(/-/g, '.');

export const getDateKeyFromIso = (isoString: string) => formatDateKey(new Date(isoString));

export const getRelativeDayLabel = (dateKey: string, todayKey = formatDateKey()) => {
  if (dateKey === todayKey) {
    return '今天';
  }

  const todayDate = new Date(`${todayKey}T00:00:00`);
  const targetDate = new Date(`${dateKey}T00:00:00`);
  const diffInDays = Math.round((todayDate.getTime() - targetDate.getTime()) / 86400000);

  if (diffInDays === 1) {
    return '昨天';
  }

  return formatDisplayDate(dateKey);
};

export const isTodayTask = (task: Task, todayKey = formatDateKey()) =>
  task.createdAt.startsWith(todayKey);

export const isTaskCompletedOnDate = (task: Task, dateKey: string) =>
  Boolean(task.completedAt && getDateKeyFromIso(task.completedAt) === dateKey);

export const isWaterEventOnDate = (waterEvent: WaterEvent, dateKey: string) =>
  getDateKeyFromIso(waterEvent.createdAt) === dateKey;
