import type { AppState } from '../types';
import { createGoal, createTask } from '../utils/goals';
import { formatDateKey } from '../utils/date';

const starterGoal = createGoal('读完一本设计入门书', 7);
starterGoal.currentSteps = 2;

const completedGoal = createGoal('完成初版设计', 1);
completedGoal.currentSteps = 1;

const archivedGoal = createGoal('做完作品集首页', 5);
archivedGoal.currentSteps = 5;
archivedGoal.archivedAt = new Date().toISOString();

const starterTaskOne = createTask('看 10 分钟 PRD 教程');
const starterTaskTwo = createTask('整理一个想做的目标');
const starterTaskThree = createTask('写下今天最重要的一件小事');
const recurringDailyTask = createTask('晚上回顾今天的一件小事', 'daily');
const recurringWeeklyTask = createTask('周末整理一次本周进展', 'weekly');

starterTaskTwo.isCompleted = true;
starterTaskTwo.completedAt = new Date().toISOString();
starterTaskTwo.lastCompletedAt = starterTaskTwo.completedAt;
starterTaskTwo.earnedDrops = 1;

starterTaskThree.isCompleted = true;
starterTaskThree.completedAt = new Date().toISOString();
starterTaskThree.lastCompletedAt = starterTaskThree.completedAt;
starterTaskThree.earnedDrops = 1;

export const initialState: AppState = {
  goals: [starterGoal, completedGoal, archivedGoal],
  tasks: [starterTaskOne, starterTaskTwo, starterTaskThree, recurringDailyTask, recurringWeeklyTask],
  selectedGoalId: starterGoal.id,
  dailyMoods: {
    [formatDateKey()]: {
      date: formatDateKey(),
      mood: 'calm',
      note: '今天先慢慢推进一点点。',
    },
  },
  waterEvents: [
    {
      id: `${starterGoal.id}-seed-1`,
      goalId: starterGoal.id,
      goalNameSnapshot: starterGoal.name,
      amount: 1,
      createdAt: new Date().toISOString(),
    },
    {
      id: `${starterGoal.id}-seed-2`,
      goalId: starterGoal.id,
      goalNameSnapshot: starterGoal.name,
      amount: 1,
      createdAt: new Date().toISOString(),
    },
    {
      id: `${completedGoal.id}-seed-1`,
      goalId: completedGoal.id,
      goalNameSnapshot: completedGoal.name,
      amount: 1,
      createdAt: new Date().toISOString(),
    },
  ],
};
