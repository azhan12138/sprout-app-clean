export type TabKey = 'habitat' | 'task' | 'review';

export type MoodKey = 'happy' | 'calm' | 'neutral' | 'tired' | 'anxious' | 'hopeful';

export type Goal = {
  id: string;
  name: string;
  currentSteps: number;
  totalSteps: number;
  createdAt: string;
  archivedAt: string | null;
};

export type TaskRecurrence = 'none' | 'daily' | 'weekly';

export type Task = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isCompleted: boolean;
  completedAt: string | null;
  recurrence: TaskRecurrence;
  earnedDrops: number;
  lastCompletedAt: string | null;
};

export type DailyMoodEntry = {
  date: string;
  mood: MoodKey;
  note: string;
};

export type WaterEvent = {
  id: string;
  goalId: string;
  goalNameSnapshot: string;
  amount: number;
  createdAt: string;
};

export type AppState = {
  goals: Goal[];
  tasks: Task[];
  selectedGoalId: string | null;
  dailyMoods: Record<string, DailyMoodEntry>;
  waterEvents: WaterEvent[];
};
