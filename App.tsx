import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import { initialState } from './src/data/seed';
import { loadAppState, saveAppState } from './src/storage/appStorage';
import type {
  AppState,
  DailyMoodEntry,
  Goal,
  MoodKey,
  TabKey,
  Task,
  TaskRecurrence,
  WaterEvent,
} from './src/types';
import {
  formatDateKey,
  formatDisplayDate,
  getDateKeyFromIso,
  getRelativeDayLabel,
} from './src/utils/date';
import {
  createGoal,
  createTask,
  createWaterEvent,
  getGoalProgress,
  getPlantStage,
  getWaterDrops,
  getTaskPeriodKey,
  isTaskCompleteForToday,
} from './src/utils/goals';

const moodOptions: Array<{ key: MoodKey; emoji: string; label: string }> = [
  { key: 'happy', emoji: '😄', label: '开心' },
  { key: 'calm', emoji: '🙂', label: '平静' },
  { key: 'neutral', emoji: '😐', label: '普通' },
  { key: 'tired', emoji: '😮‍💨', label: '疲惫' },
  { key: 'anxious', emoji: '😣', label: '焦虑' },
  { key: 'hopeful', emoji: '🌱', label: '有希望' },
];

type DailyReviewItem = {
  date: string;
  mood: DailyMoodEntry | null;
  completedTasks: Task[];
  waterEvents: WaterEvent[];
};

const moodFeedbackMap: Record<MoodKey, string> = {
  happy: '把这份轻盈也种进今天。',
  calm: '慢慢来，今天也会有一点生长。',
  neutral: '普通的一天，也能完成一件小事。',
  tired: '累的时候，也可以只做最小的一步。',
  anxious: '先不用做很多，先完成一件小事就好。',
  hopeful: '这份期待，值得被慢慢养大。',
};

const recurrenceMeta: Array<{ key: TaskRecurrence; label: string }> = [
  { key: 'none', label: '只做一次' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
];

const getMoodMeta = (mood: MoodKey) =>
  moodOptions.find((option) => option.key === mood) ?? moodOptions[0];

const getDailySummaryText = (item: DailyReviewItem) => {
  const moodText = item.mood ? `${getMoodMeta(item.mood.mood).emoji} ${getMoodMeta(item.mood.mood).label}` : '未记录心情';
  const completedTaskText = `完成 ${item.completedTasks.length} 个任务`;
  const waterEventText = `浇灌 ${item.waterEvents.length} 次`;

  return `${moodText} · ${completedTaskText} · ${waterEventText}`;
};

const getRecurrenceText = (recurrence: TaskRecurrence) => {
  if (recurrence === 'daily') {
    return '每日';
  }

  if (recurrence === 'weekly') {
    return '每周';
  }

  return '一次';
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('habitat');
  const [appState, setAppState] = useState<AppState>(initialState);
  const [goalNameInput, setGoalNameInput] = useState('');
  const [goalStepsInput, setGoalStepsInput] = useState('');
  const [goalProgressInput, setGoalProgressInput] = useState('0');
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalDetailGoalId, setGoalDetailGoalId] = useState<string | null>(null);
  const [showArchivedGoals, setShowArchivedGoals] = useState(false);

  const [taskInput, setTaskInput] = useState('');
  const [taskRecurrenceInput, setTaskRecurrenceInput] = useState<TaskRecurrence>('none');
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEditInput, setTaskEditInput] = useState('');
  const [taskEditRecurrence, setTaskEditRecurrence] = useState<TaskRecurrence>('none');

  const [moodNoteInput, setMoodNoteInput] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const storedState = await loadAppState();

      if (mounted && storedState) {
        setAppState(storedState);
        setMoodNoteInput(storedState.dailyMoods[formatDateKey()]?.note ?? '');
      }

      if (mounted) {
        setIsReady(true);
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    saveAppState(appState);
  }, [appState, isReady]);

  const todayKey = formatDateKey();
  const waterDrops = useMemo(() => getWaterDrops(appState), [appState]);
  const todayMood = appState.dailyMoods[todayKey] ?? null;
  const detailGoal = appState.goals.find((goal) => goal.id === goalDetailGoalId) ?? null;
  const detailGoalIndex = detailGoal ? appState.goals.findIndex((goal) => goal.id === detailGoal.id) : -1;
  const detailPlantStage = detailGoal ? getPlantStage(detailGoal) : null;

  useEffect(() => {
    setMoodNoteInput(todayMood?.note ?? '');
  }, [todayMood?.note, todayKey]);

  const visibleGoals = useMemo(() => {
    return appState.goals.filter((goal) => (showArchivedGoals ? true : goal.archivedAt === null));
  }, [appState.goals, showArchivedGoals]);

  const todayTasks = useMemo(() => {
    const tasksForToday = appState.tasks;

    return [...tasksForToday].sort((left, right) => {
      const leftDone = isTaskCompleteForToday(left);
      const rightDone = isTaskCompleteForToday(right);

      if (leftDone !== rightDone) {
        return leftDone ? 1 : -1;
      }

      if (left.recurrence !== right.recurrence) {
        return left.recurrence === 'none' ? 1 : -1;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [appState.tasks, todayKey]);


  const reviewItems = useMemo<DailyReviewItem[]>(() => {
    const dateKeySet = new Set<string>();

    Object.keys(appState.dailyMoods).forEach((dateKey) => dateKeySet.add(dateKey));
    appState.tasks.forEach((task) => {
      if (task.completedAt) {
        dateKeySet.add(getDateKeyFromIso(task.completedAt));
      }
    });
    appState.waterEvents.forEach((waterEvent) => {
      dateKeySet.add(getDateKeyFromIso(waterEvent.createdAt));
    });

    return Array.from(dateKeySet)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({
        date,
        mood: appState.dailyMoods[date] ?? null,
        completedTasks: appState.tasks.filter(
          (task) => task.completedAt && getDateKeyFromIso(task.completedAt) === date
        ),
        waterEvents: appState.waterEvents.filter(
          (waterEvent) => getDateKeyFromIso(waterEvent.createdAt) === date
        ),
      }));
  }, [appState.dailyMoods, appState.tasks, appState.waterEvents]);

  const updateGoals = (updater: (goals: Goal[]) => Goal[]) => {
    setAppState((currentState) => {
      const nextGoals = updater(currentState.goals);
      const nextSelectedGoalId =
        nextGoals.find((goal) => goal.id === currentState.selectedGoalId)?.id ?? nextGoals[0]?.id ?? null;

      return {
        ...currentState,
        goals: nextGoals,
        selectedGoalId: nextSelectedGoalId,
      };
    });
  };

  const resetGoalForm = () => {
    setGoalNameInput('');
    setGoalStepsInput('');
    setGoalProgressInput('0');
    setEditingGoalId(null);
  };

  const handleOpenCreateGoalModal = () => {
    resetGoalForm();
    setGoalModalVisible(true);
  };

  const handleCloseGoalModal = () => {
    setGoalModalVisible(false);
    resetGoalForm();
  };

  const handleCreateGoal = () => {
    const name = goalNameInput.trim();
    const totalSteps = Number(goalStepsInput);
    const currentSteps = Number(goalProgressInput);

    if (!name || !Number.isInteger(totalSteps) || totalSteps <= 0 || Number.isNaN(currentSteps) || currentSteps < 0) {
      return;
    }

    const nextGoal = {
      ...createGoal(name, totalSteps),
      currentSteps: Math.min(Math.floor(currentSteps), totalSteps),
    };

    setAppState((currentState) => ({
      ...currentState,
      goals: [...currentState.goals, nextGoal],
      selectedGoalId: nextGoal.id,
    }));
    handleCloseGoalModal();
    setGoalDetailGoalId(nextGoal.id);
    setActiveTab('habitat');
  };

  const handleOpenEditGoalModal = (goal: Goal) => {
    setGoalDetailGoalId(null);
    setEditingGoalId(goal.id);
    setGoalNameInput(goal.name);
    setGoalStepsInput(String(goal.totalSteps));
    setGoalProgressInput(String(goal.currentSteps));
    setGoalModalVisible(true);
  };

  const handleSaveGoal = () => {
    const name = goalNameInput.trim();
    const totalSteps = Number(goalStepsInput);
    const currentSteps = Number(goalProgressInput);

    if (!name || !Number.isInteger(totalSteps) || totalSteps <= 0 || Number.isNaN(currentSteps) || currentSteps < 0) {
      return;
    }

    if (!editingGoalId) {
      handleCreateGoal();
      return;
    }

    updateGoals((goals) =>
      goals.map((goal) =>
        goal.id === editingGoalId
          ? {
              ...goal,
              name,
              totalSteps,
              currentSteps: Math.min(Math.floor(currentSteps), totalSteps),
            }
          : goal
      )
    );

    setGoalDetailGoalId(editingGoalId);
    handleCloseGoalModal();
  };

  const handleDeleteGoal = (goal: Goal) => {
    Alert.alert('删除这个目标？', `“${goal.name}”会从栖息地里移除，对应浇灌记录也会一起删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          updateGoals((goals) => goals.filter((item) => item.id !== goal.id));
          setAppState((currentState) => ({
            ...currentState,
            waterEvents: currentState.waterEvents.filter((event) => event.goalId !== goal.id),
          }));
          setGoalDetailGoalId(null);
        },
      },
    ]);
  };

  const handleMoveGoalToEdge = (goalId: string, edge: 'start' | 'end') => {
    updateGoals((goals) => {
      const currentIndex = goals.findIndex((goal) => goal.id === goalId);

      if (currentIndex < 0) {
        return goals;
      }

      const nextGoals = [...goals];
      const [movedGoal] = nextGoals.splice(currentIndex, 1);

      if (edge === 'start') {
        nextGoals.unshift(movedGoal);
      } else {
        nextGoals.push(movedGoal);
      }

      return nextGoals;
    });
  };

  const handleMoveGoalByOffset = (goalId: string, offset: -1 | 1) => {
    updateGoals((goals) => {
      const currentIndex = goals.findIndex((goal) => goal.id === goalId);

      if (currentIndex < 0) {
        return goals;
      }

      const targetIndex = currentIndex + offset;

      if (targetIndex < 0 || targetIndex >= goals.length) {
        return goals;
      }

      const nextGoals = [...goals];
      const [movedGoal] = nextGoals.splice(currentIndex, 1);
      nextGoals.splice(targetIndex, 0, movedGoal);
      return nextGoals;
    });
  };

  const handleToggleArchiveGoal = (goalId: string) => {
    updateGoals((goals) =>
      goals.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              archivedAt: goal.archivedAt ? null : new Date().toISOString(),
            }
          : goal
      )
    );
    setGoalDetailGoalId(goalId);
  };

  const handleOpenGoalDetail = (goalId: string) => {
    setAppState((currentState) => ({
      ...currentState,
      selectedGoalId: goalId,
    }));
    setGoalDetailGoalId(goalId);
  };

  const handleWaterGoal = (goalId: string) => {
    const targetGoal = appState.goals.find((goal) => goal.id === goalId);

    if (!targetGoal || waterDrops <= 0 || targetGoal.currentSteps >= targetGoal.totalSteps) {
      return;
    }

    updateGoals((goals) =>
      goals.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              currentSteps: Math.min(goal.currentSteps + 1, goal.totalSteps),
            }
          : goal
      )
    );

    setAppState((currentState) => ({
      ...currentState,
      waterEvents: [createWaterEvent(targetGoal), ...currentState.waterEvents],
    }));
  };

  const resetTaskEditForm = () => {
    setEditingTaskId(null);
    setTaskEditInput('');
    setTaskEditRecurrence('none');
  };

  const handleAddTask = () => {
    const content = taskInput.trim();

    if (!content) {
      return;
    }

    setAppState((currentState) => ({
      ...currentState,
      tasks: [createTask(content, taskRecurrenceInput), ...currentState.tasks],
    }));
    setTaskInput('');
    setTaskRecurrenceInput('none');
  };

  const handleToggleTask = (taskId: string) => {
    const now = new Date();
    const nowIso = now.toISOString();

    setAppState((currentState) => ({
      ...currentState,
      tasks: currentState.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        const isCompleteNow = isTaskCompleteForToday(task, now);

        if (task.recurrence === 'none') {
          return {
            ...task,
            isCompleted: !task.isCompleted,
            completedAt: !task.isCompleted ? nowIso : null,
            lastCompletedAt: !task.isCompleted ? nowIso : null,
            updatedAt: nowIso,
            earnedDrops: Math.max(task.earnedDrops + (!task.isCompleted ? 1 : -1), 0),
          };
        }

        if (isCompleteNow) {
          return {
            ...task,
            isCompleted: false,
            updatedAt: nowIso,
            earnedDrops: Math.max(task.earnedDrops - 1, 0),
            lastCompletedAt: null,
          };
        }

        return {
          ...task,
          isCompleted: true,
          completedAt: nowIso,
          lastCompletedAt: nowIso,
          updatedAt: nowIso,
          earnedDrops: task.earnedDrops + 1,
        };
      }),
    }));
  };

  const handleOpenEditTaskModal = (task: Task) => {
    setEditingTaskId(task.id);
    setTaskEditInput(task.content);
    setTaskEditRecurrence(task.recurrence);
    setTaskModalVisible(true);
  };

  const handleCloseTaskModal = () => {
    setTaskModalVisible(false);
    resetTaskEditForm();
  };

  const handleSaveTask = () => {
    const content = taskEditInput.trim();

    if (!content || !editingTaskId) {
      return;
    }

    setAppState((currentState) => ({
      ...currentState,
      tasks: currentState.tasks.map((task) =>
        task.id === editingTaskId
          ? {
              ...task,
              content,
              recurrence: taskEditRecurrence,
              updatedAt: new Date().toISOString(),
            }
          : task
      ),
    }));
    handleCloseTaskModal();
  };

  const handleDeleteTask = (task: Task) => {
    Alert.alert('删除这个任务？', `“${task.content}”会从任务列表里移除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setAppState((currentState) => ({
            ...currentState,
            tasks: currentState.tasks.filter((item) => item.id !== task.id),
          }));
        },
      },
    ]);
  };

  const handleSelectMood = (mood: MoodKey) => {
    setAppState((currentState) => ({
      ...currentState,
      dailyMoods: {
        ...currentState.dailyMoods,
        [todayKey]: {
          date: todayKey,
          mood,
          note: currentState.dailyMoods[todayKey]?.note ?? moodNoteInput,
        },
      },
    }));
  };

  const handleChangeMoodNote = (note: string) => {
    setMoodNoteInput(note);
    setAppState((currentState) => ({
      ...currentState,
      dailyMoods: {
        ...currentState.dailyMoods,
        [todayKey]: {
          date: todayKey,
          mood: currentState.dailyMoods[todayKey]?.mood ?? 'calm',
          note,
        },
      },
    }));
  };

  const waterHint =
    waterDrops > 0 ? '选一株正在成长的植物，给它一滴今天的行动。' : '再完成 1 个任务，就能继续浇灌。';

  const renderGoalTile = (goal: Goal) => {
    const plantStage = getPlantStage(goal);
    const progressPercent = Math.round(getGoalProgress(goal) * 100);

    return (
      <View key={goal.id} style={styles.goalTileColumn}>
        <Pressable style={styles.goalTile} onPress={() => handleOpenGoalDetail(goal.id)}>
          <Text style={styles.goalTileEmoji}>{plantStage.emoji}</Text>
          <Text style={styles.goalTileName} numberOfLines={1}>
            {goal.name}
          </Text>
          <Text style={styles.goalTileMeta}>
            {goal.currentSteps} / {goal.totalSteps}
          </Text>
          {goal.archivedAt ? <Text style={styles.goalBadge}>已归档</Text> : null}
          <View style={styles.goalTileTrack}>
            <View style={[styles.goalTileFill, { width: `${progressPercent}%` }]} />
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
          <View style={styles.appShell}>
        <View style={styles.headerBlock}>
          <Text style={styles.appTitle}>芽 Sprout</Text>
          <Text style={styles.appSubtitle}>今天做一点，梦想就会长一点</Text>
        </View>

        <View style={styles.tabBar}>
          <TabButton label="栖息地" isActive={activeTab === 'habitat'} onPress={() => setActiveTab('habitat')} />
          <TabButton label="劳作" isActive={activeTab === 'task'} onPress={() => setActiveTab('task')} />
          <TabButton label="回顾" isActive={activeTab === 'review'} onPress={() => setActiveTab('review')} />
        </View>

        {activeTab === 'habitat' ? (
          <ScrollView contentContainerStyle={styles.pageContent}>
            <View style={styles.waterSummaryCard}>
              <View>
                <Text style={styles.waterSummaryLabel}>今日可用水滴</Text>
                <Text style={styles.waterSummaryCount}>{waterDrops} 💧</Text>
              </View>
              <Text style={styles.waterSummaryHint}>{waterHint}</Text>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>我的栖息地</Text>
                <Text style={styles.sectionText}>点开一株植物，看看它今天能长多高。</Text>
              </View>

              <View style={styles.archiveRow}>
                <Pressable
                  style={[styles.archiveToggle, showArchivedGoals && styles.archiveToggleActive]}
                  onPress={() => setShowArchivedGoals((value) => !value)}
                >
                  <Text style={[styles.archiveToggleText, showArchivedGoals && styles.archiveToggleTextActive]}>
                    {showArchivedGoals ? '隐藏归档' : '显示归档'}
                  </Text>
                </Pressable>
              </View>

              {visibleGoals.length === 0 ? (
                <View style={styles.emptyTaskState}>
                  <Text style={styles.emptyTaskTitle}>栖息地还很安静</Text>
                  <Text style={styles.emptyTaskText}>先播下一颗种子，或者把已经归档的花再翻出来看看。</Text>
                </View>
              ) : (
                <View style={styles.goalGrid}>{visibleGoals.map((goal) => renderGoalTile(goal))}</View>
              )}

              <Pressable style={[styles.goalTile, styles.goalTileStandalone, styles.newGoalTile]} onPress={handleOpenCreateGoalModal}>
                <Text style={styles.newGoalPlus}>＋</Text>
                <Text style={styles.newGoalTitle}>播种新目标</Text>
                <Text style={styles.newGoalText}>把新的种子放进你的栖息地。</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : activeTab === 'task' ? (
          <ScrollView contentContainerStyle={styles.pageContent}>
            <View style={styles.moodCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>今天感觉怎么样？</Text>
                <Text style={styles.sectionText}>先记下今天的状态，再轻轻开始。</Text>
              </View>
              <View style={styles.moodRow}>
                {moodOptions.map((option) => {
                  const isSelected = todayMood?.mood === option.key;

                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.moodChip, isSelected && styles.moodChipActive]}
                      onPress={() => handleSelectMood(option.key)}
                    >
                      <Text style={styles.moodEmoji}>{option.emoji}</Text>
                      <Text style={[styles.moodLabel, isSelected && styles.moodLabelActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={moodNoteInput}
                onChangeText={handleChangeMoodNote}
                placeholder="补一句今天的小备注（可选）"
                placeholderTextColor="#7B8D78"
                maxLength={40}
                style={styles.noteInput}
              />
              {todayMood ? (
                <View style={styles.moodFeedbackCard}>
                  <Text style={styles.moodFeedbackText}>{moodFeedbackMap[todayMood.mood]}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>目标</Text>
              <Text style={styles.sectionText}>想扩建栖息地时，也可以在这里播下一颗新种子。</Text>
              <PrimaryButton label="播种新目标" onPress={handleOpenCreateGoalModal} />
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>今日任务</Text>
                <Text style={styles.sectionText}>先完成一件小事，收集今天的水滴。</Text>
              </View>

              <View style={styles.inputRow}>
                <TextInput
                  value={taskInput}
                  onChangeText={setTaskInput}
                  placeholder="例如：看 10 分钟英语"
                  placeholderTextColor="#7B8D78"
                  style={styles.textInput}
                />
                <Pressable style={styles.addButton} onPress={handleAddTask}>
                  <Text style={styles.addButtonText}>添加</Text>
                </Pressable>
              </View>

              <View style={styles.filterRow}>
                {recurrenceMeta.map((option) => (
                  <FilterChip
                    key={option.key}
                    label={option.label}
                    isActive={taskRecurrenceInput === option.key}
                    onPress={() => setTaskRecurrenceInput(option.key)}
                  />
                ))}
              </View>

              {todayTasks.length === 0 ? (
                <View style={styles.emptyTaskState}>
                  <Text style={styles.emptyTaskTitle}>给自己安排一件小事吧</Text>
                  <Text style={styles.emptyTaskText}>从一个很轻的小动作开始，今天就能收集第一滴水。</Text>
                </View>
              ) : (
                todayTasks.map((task) => {
                  const isCompleted = isTaskCompleteForToday(task);
                  const currentPeriodKey = getTaskPeriodKey(task.recurrence);
                  const lastPeriodKey = task.lastCompletedAt ? getTaskPeriodKey(task.recurrence, new Date(task.lastCompletedAt)) : null;
                  const rewardText =
                    task.recurrence === 'none'
                      ? isCompleted
                        ? '+1 💧 已领取'
                        : '完成后获得 1 💧'
                      : currentPeriodKey && currentPeriodKey === lastPeriodKey
                        ? `本${task.recurrence === 'daily' ? '日' : '周'}已领取 +1 💧`
                        : `完成后获得本${task.recurrence === 'daily' ? '日' : '周'} 1 💧`;

                  return (
                    <Pressable
                      key={task.id}
                      style={styles.taskItem}
                      onPress={() => handleToggleTask(task.id)}
                      onLongPress={() => handleOpenEditTaskModal(task)}
                    >
                      <View style={[styles.checkbox, isCompleted && styles.checkboxChecked]}>
                        {isCompleted ? <Text style={styles.checkboxMark}>✓</Text> : null}
                      </View>
                      <View style={styles.taskTextWrap}>
                        <Text style={[styles.taskText, isCompleted && styles.taskTextDone]}>{task.content}</Text>
                        <Text style={styles.taskReward}>
                          {getRecurrenceText(task.recurrence)} · {rewardText}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.pageContent}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>回顾</Text>
                <Text style={styles.sectionText}>看看这些小事，怎样慢慢养大了你的目标。</Text>
              </View>
            </View>

            {reviewItems.length === 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.emptyTaskTitle}>还没有可以回顾的记录</Text>
                <Text style={styles.emptyTaskText}>先记录今天的心情，或者完成一件小事吧。</Text>
              </View>
            ) : (
              reviewItems.map((item) => (
                <View key={item.date} style={styles.reviewCard}>
                  <Text style={styles.reviewDate}>{getRelativeDayLabel(item.date, todayKey)}</Text>
                  <Text style={styles.reviewDateSub}>{formatDisplayDate(item.date)}</Text>
                  <Text style={styles.reviewSummaryText}>{getDailySummaryText(item)}</Text>

                  {item.mood?.note ? <Text style={styles.reviewNote}>“{item.mood.note}”</Text> : null}

                  <View style={styles.reviewSection}>
                    <Text style={styles.reviewSectionTitle}>完成任务</Text>
                    {item.completedTasks.length === 0 ? (
                      <Text style={styles.reviewEmptyText}>这一天还没有完成任务。</Text>
                    ) : (
                      item.completedTasks.map((task) => (
                        <Text key={task.id} style={styles.reviewListItem}>
                          • {task.content}（{getRecurrenceText(task.recurrence)}）
                        </Text>
                      ))
                    )}
                  </View>

                  <View style={styles.reviewSection}>
                    <Text style={styles.reviewSectionTitle}>目标推进</Text>
                    {item.waterEvents.length === 0 ? (
                      <Text style={styles.reviewEmptyText}>这一天还没有浇灌记录。</Text>
                    ) : (
                      item.waterEvents.map((waterEvent) => (
                        <Text key={waterEvent.id} style={styles.reviewListItem}>
                          • {waterEvent.goalNameSnapshot} +{waterEvent.amount}
                        </Text>
                      ))
                    )}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
      </KeyboardAvoidingView>
      </TouchableWithoutFeedback>

      <Modal
        animationType="slide"
        transparent
        visible={goalDetailGoalId !== null && detailGoal !== null}
        onRequestClose={() => setGoalDetailGoalId(null)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView
            style={styles.modalKeyboardAvoidingView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.detailModalCard}>
            <Pressable style={styles.detailCloseButton} onPress={() => setGoalDetailGoalId(null)}>
              <Text style={styles.detailCloseButtonText}>×</Text>
            </Pressable>

            <View style={styles.detailHeroRow}>
              <View style={styles.goalOrderSideColumn}>
                <Pressable
                  style={[styles.goalOrderButton, detailGoalIndex <= 0 && styles.goalOrderButtonDisabled]}
                  onPress={() => detailGoal && handleMoveGoalToEdge(detailGoal.id, 'start')}
                  disabled={!detailGoal || detailGoalIndex <= 0}
                >
                  <Text style={styles.goalOrderButtonIcon}>«</Text>
                  <Text style={styles.goalOrderButtonLabel}>最前</Text>
                </Pressable>
                <Pressable
                  style={[styles.goalOrderButton, detailGoalIndex <= 0 && styles.goalOrderButtonDisabled]}
                  onPress={() => detailGoal && handleMoveGoalByOffset(detailGoal.id, -1)}
                  disabled={!detailGoal || detailGoalIndex <= 0}
                >
                  <Text style={styles.goalOrderButtonIcon}>‹</Text>
                  <Text style={styles.goalOrderButtonLabel}>前移</Text>
                </Pressable>
              </View>

              <View style={styles.detailHeroCenter}>
                <Text style={styles.detailPlantEmoji}>{detailPlantStage?.emoji}</Text>
                <Text style={styles.detailGoalName}>{detailGoal?.name}</Text>
                <Text style={styles.detailGoalStage}>{detailPlantStage?.label}</Text>
              </View>

              <View style={styles.goalOrderSideColumn}>
                <Pressable
                  style={[
                    styles.goalOrderButton,
                    detailGoalIndex < 0 || detailGoalIndex >= appState.goals.length - 1 ? styles.goalOrderButtonDisabled : null,
                  ]}
                  onPress={() => detailGoal && handleMoveGoalByOffset(detailGoal.id, 1)}
                  disabled={!detailGoal || detailGoalIndex < 0 || detailGoalIndex >= appState.goals.length - 1}
                >
                  <Text style={styles.goalOrderButtonIcon}>›</Text>
                  <Text style={styles.goalOrderButtonLabel}>后移</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.goalOrderButton,
                    detailGoalIndex < 0 || detailGoalIndex >= appState.goals.length - 1 ? styles.goalOrderButtonDisabled : null,
                  ]}
                  onPress={() => detailGoal && handleMoveGoalToEdge(detailGoal.id, 'end')}
                  disabled={!detailGoal || detailGoalIndex < 0 || detailGoalIndex >= appState.goals.length - 1}
                >
                  <Text style={styles.goalOrderButtonIcon}>»</Text>
                  <Text style={styles.goalOrderButtonLabel}>最后</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.detailGoalMeta}>
              {detailGoal?.currentSteps} / {detailGoal?.totalSteps} · {detailGoal ? Math.round(getGoalProgress(detailGoal) * 100) : 0}%
            </Text>
            <View style={styles.detailProgressTrack}>
              <View
                style={[
                  styles.detailProgressFill,
                  {
                    width: detailGoal ? `${Math.round(getGoalProgress(detailGoal) * 100)}%` : '0%',
                  },
                ]}
              />
            </View>

            <View style={styles.detailModalActions}>
              <Pressable style={styles.secondaryButton} onPress={() => detailGoal && handleOpenEditGoalModal(detailGoal)}>
                <Text style={styles.secondaryButtonText}>编辑目标</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, styles.dangerButton]}
                onPress={() => detailGoal && handleDeleteGoal(detailGoal)}
              >
                <Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>删除目标</Text>
              </Pressable>
            </View>

            {detailGoal && detailGoal.currentSteps >= detailGoal.totalSteps ? (
              <Pressable style={styles.archiveButton} onPress={() => handleToggleArchiveGoal(detailGoal.id)}>
                <Text style={styles.archiveButtonText}>{detailGoal.archivedAt ? '取消归档' : '归档这朵花'}</Text>
              </Pressable>
            ) : null}

            <View style={styles.detailWaterRow}>
              <Text style={styles.detailWaterLabel}>可用水滴</Text>
              <Text style={styles.detailWaterCount}>{waterDrops} 💧</Text>
            </View>

            <PrimaryButton
              label={
                detailGoal && detailGoal.currentSteps >= detailGoal.totalSteps
                  ? '已开花'
                  : waterDrops > 0
                    ? '浇灌 +1'
                    : '先去收集水滴'
              }
              disabled={!detailGoal || waterDrops <= 0 || detailGoal.currentSteps >= detailGoal.totalSteps}
              onPress={() => detailGoal && handleWaterGoal(detailGoal.id)}
            />

            <Text style={styles.detailHint}>今天的小事，正在让它慢慢长大。</Text>
          </View>
        </View>
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal animationType="slide" transparent visible={goalModalVisible} onRequestClose={handleCloseGoalModal}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView
            style={styles.modalKeyboardAvoidingView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingGoalId ? '编辑目标' : '播种新目标'}</Text>
            <Text style={styles.modalText}>
              {editingGoalId ? '调整这颗种子的名字、步数和当前进度。' : '先写下一个你愿意慢慢养大的目标。'}
            </Text>

            <TextInput
              value={goalNameInput}
              onChangeText={setGoalNameInput}
              placeholder="目标名称"
              placeholderTextColor="#7B8D78"
              style={styles.modalInput}
            />
            <TextInput
              value={goalStepsInput}
              onChangeText={setGoalStepsInput}
              placeholder="总步数，例如 21"
              placeholderTextColor="#7B8D78"
              keyboardType="number-pad"
              style={styles.modalInput}
            />
            <TextInput
              value={goalProgressInput}
              onChangeText={setGoalProgressInput}
              placeholder="当前进度，例如 3"
              placeholderTextColor="#7B8D78"
              keyboardType="number-pad"
              style={styles.modalInput}
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryButton} onPress={handleCloseGoalModal}>
                <Text style={styles.secondaryButtonText}>取消</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleSaveGoal}>
                <Text style={styles.primaryButtonText}>{editingGoalId ? '保存' : '创建'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal animationType="slide" transparent visible={taskModalVisible} onRequestClose={handleCloseTaskModal}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView
            style={styles.modalKeyboardAvoidingView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>编辑任务</Text>
            <Text style={styles.modalText}>调整任务内容，或者把它改成每日 / 每周的小习惯。</Text>

            <TextInput
              value={taskEditInput}
              onChangeText={setTaskEditInput}
              placeholder="任务内容"
              placeholderTextColor="#7B8D78"
              style={styles.modalInput}
            />

            <View style={styles.filterRow}>
              {recurrenceMeta.map((option) => (
                <FilterChip
                  key={option.key}
                  label={option.label}
                  isActive={taskEditRecurrence === option.key}
                  onPress={() => setTaskEditRecurrence(option.key)}
                />
              ))}
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.secondaryButton, styles.dangerButton]}
                onPress={() => {
                  const targetTask = appState.tasks.find((task) => task.id === editingTaskId);
                  if (targetTask) {
                    handleCloseTaskModal();
                    handleDeleteTask(targetTask);
                  }
                }}
              >
                <Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>删除</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={handleCloseTaskModal}>
                <Text style={styles.secondaryButtonText}>取消</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleSaveTask}>
                <Text style={styles.primaryButtonText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

type TabButtonProps = {
  label: string;
  isActive: boolean;
  onPress: () => void;
};

function TabButton({ label, isActive, onPress }: TabButtonProps) {
  return (
    <Pressable style={[styles.tabButton, isActive && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

type FilterChipProps = {
  label: string;
  isActive: boolean;
  onPress: () => void;
};

function FilterChip({ label, isActive, onPress }: FilterChipProps) {
  return (
    <Pressable style={[styles.filterChip, isActive && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function PrimaryButton({ label, onPress, disabled = false }: PrimaryButtonProps) {
  return (
    <Pressable
      style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F1E8',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  appShell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 34,
  },
  headerBlock: {
    gap: 8,
    paddingTop: 8,
  },
  appTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: '#254336',
  },
  appSubtitle: {
    maxWidth: 260,
    fontSize: 16,
    lineHeight: 24,
    color: '#5F735C',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#E4E0D3',
    borderRadius: 18,
    padding: 4,
    marginTop: 24,
  },
  tabButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#254336',
  },
  tabButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4C5E4A',
  },
  tabButtonTextActive: {
    color: '#F9F7F1',
  },
  pageContent: {
    paddingVertical: 20,
    gap: 16,
  },
  coverCard: {
    backgroundColor: '#FCFBF7',
    borderRadius: 24,
    padding: 8,
  },
  coverImage: {
    width: '100%',
    height: 156,
    borderRadius: 20,
  },
  waterSummaryCard: {
    backgroundColor: '#FCFBF7',
    borderRadius: 26,
    padding: 20,
    gap: 12,
  },
  waterSummaryLabel: {
    fontSize: 14,
    color: '#70806B',
  },
  waterSummaryCount: {
    marginTop: 6,
    fontSize: 30,
    fontWeight: '700',
    color: '#254336',
  },
  waterSummaryHint: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5F735C',
  },
  sectionCard: {
    backgroundColor: '#FCFBF7',
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  moodCard: {
    backgroundColor: '#FCFBF7',
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  moodChip: {
    width: '30.5%',
    backgroundColor: '#F4F0E5',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
  },
  moodChipActive: {
    backgroundColor: '#DDE9D0',
  },
  moodFeedbackCard: {
    backgroundColor: '#EEF3E5',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  moodFeedbackText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#2E4A3A',
    textAlign: 'center',
  },
  noteInput: {
    minHeight: 48,
    backgroundColor: '#F2EFE6',
    borderRadius: 16,
    paddingHorizontal: 14,
    color: '#254336',
    fontSize: 14,
  },
  moodEmoji: {
    fontSize: 22,
  },
  moodLabel: {
    fontSize: 12,
    color: '#5F735C',
  },
  moodLabelActive: {
    color: '#254336',
    fontWeight: '700',
  },
  sectionHeaderRow: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#254336',
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5F735C',
  },
  sectionHint: {
    fontSize: 13,
    color: '#70806B',
    lineHeight: 20,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F1ECE0',
  },
  filterChipActive: {
    backgroundColor: '#DDE9D0',
  },
  filterChipText: {
    fontSize: 12,
    color: '#5F735C',
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#254336',
  },
  archiveRow: {
    alignItems: 'flex-start',
  },
  archiveToggle: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F1ECE0',
  },
  archiveToggleActive: {
    backgroundColor: '#DDE9D0',
  },
  archiveToggleText: {
    fontSize: 12,
    color: '#5F735C',
    fontWeight: '600',
  },
  archiveToggleTextActive: {
    color: '#254336',
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    paddingTop: 2,
    paddingBottom: 4,
  },
  goalTile: {
    minHeight: 146,
    backgroundColor: '#F6F2E8',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  goalTileRow: {
    gap: 12,
    marginBottom: 12,
  },
  goalTileColumn: {
    width: '47%',
  },
  goalTileStandalone: {
    width: '47%',
    alignSelf: 'flex-start',
  },
  goalTileDisabled: {
    opacity: 0.5,
  },
  goalTileEmoji: {
    fontSize: 30,
  },
  goalTileName: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    color: '#254336',
    textAlign: 'center',
  },
  goalTileMeta: {
    fontSize: 12,
    color: '#70806B',
    textAlign: 'center',
  },
  goalTileSubMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: '#869480',
    textAlign: 'center',
  },
  goalBadge: {
    fontSize: 11,
    color: '#2E4A3A',
    backgroundColor: '#DDE9D0',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  goalTileTrack: {
    width: '100%',
    height: 7,
    borderRadius: 999,
    backgroundColor: '#D8E3CB',
    overflow: 'hidden',
  },
  goalTileFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#7FA36B',
  },
  newGoalTile: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B9C5AE',
    backgroundColor: '#F8F5ED',
  },
  newGoalPlus: {
    fontSize: 24,
    color: '#6F8667',
    fontWeight: '400',
  },
  newGoalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2E4A3A',
    textAlign: 'center',
  },
  newGoalText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#70806B',
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    minHeight: 48,
    backgroundColor: '#F2EFE6',
    borderRadius: 16,
    paddingHorizontal: 14,
    color: '#254336',
    fontSize: 15,
  },
  addButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D8E3CB',
  },
  addButtonText: {
    color: '#2E4A3A',
    fontSize: 15,
    fontWeight: '700',
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ECE7DA',
  },
  taskMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  taskActionColumn: {
    gap: 6,
  },
  inlineActionButton: {
    minWidth: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F1ECE0',
    alignItems: 'center',
  },
  inlineActionText: {
    fontSize: 12,
    color: '#4C5E4A',
    fontWeight: '600',
  },
  inlineDangerButton: {
    backgroundColor: '#F5E6E1',
  },
  inlineDangerText: {
    color: '#A25140',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#AAB9A4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#7FA36B',
    borderColor: '#7FA36B',
  },
  checkboxMark: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  taskTextWrap: {
    flex: 1,
    gap: 4,
  },
  taskText: {
    fontSize: 15,
    color: '#2E4A3A',
  },
  taskTextDone: {
    color: '#7B8D78',
    textDecorationLine: 'line-through',
  },
  taskReward: {
    fontSize: 12,
    color: '#7B8D78',
  },
  emptyTaskState: {
    paddingTop: 8,
    paddingBottom: 12,
    gap: 6,
  },
  emptyTaskTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2E4A3A',
  },
  emptyTaskText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#70806B',
  },
  reviewCard: {
    backgroundColor: '#FCFBF7',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  reviewDate: {
    fontSize: 18,
    fontWeight: '700',
    color: '#254336',
  },
  reviewDateSub: {
    marginTop: -4,
    fontSize: 12,
    color: '#8B9985',
  },
  reviewSummaryText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5F735C',
  },
  reviewNote: {
    fontSize: 14,
    lineHeight: 20,
    color: '#2E4A3A',
  },
  reviewSection: {
    gap: 6,
  },
  reviewSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2E4A3A',
  },
  reviewListItem: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5F735C',
  },
  reviewEmptyText: {
    fontSize: 13,
    color: '#70806B',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#254336',
  },
  primaryButtonDisabled: {
    backgroundColor: '#9BAA98',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E4E0D3',
  },
  secondaryButtonText: {
    color: '#2E4A3A',
    fontSize: 15,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(29, 42, 35, 0.28)',
    justifyContent: 'flex-end',
  },
  modalKeyboardAvoidingView: {
    flex: 1,
  },
  modalCard: {
    backgroundColor: '#FCFBF7',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#254336',
  },
  modalText: {
    fontSize: 14,
    color: '#5F735C',
    lineHeight: 21,
  },
  modalInput: {
    minHeight: 48,
    backgroundColor: '#F2EFE6',
    borderRadius: 16,
    paddingHorizontal: 14,
    color: '#254336',
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  detailModalActions: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  dangerButton: {
    backgroundColor: '#F5E6E1',
  },
  dangerButtonText: {
    color: '#A25140',
  },
  archiveButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#EEF3E5',
  },
  archiveButtonText: {
    color: '#2E4A3A',
    fontWeight: '700',
    fontSize: 14,
  },
  detailModalCard: {
    backgroundColor: '#FCFBF7',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 28,
    alignItems: 'center',
    gap: 12,
  },
  detailCloseButton: {
    alignSelf: 'flex-end',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFE9DB',
  },
  detailCloseButtonText: {
    fontSize: 20,
    color: '#4C5E4A',
    lineHeight: 22,
  },
  detailPlantEmoji: {
    fontSize: 72,
  },
  detailGoalName: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    color: '#254336',
    textAlign: 'center',
  },
  detailGoalStage: {
    fontSize: 14,
    color: '#70806B',
  },
  detailGoalMeta: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#254336',
  },
  detailHeroRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailHeroCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  goalOrderSideColumn: {
    width: 60,
    gap: 7,
  },
  goalOrderButton: {
    minHeight: 52,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: '#F3EEE4',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  goalOrderButtonDisabled: {
    opacity: 0.36,
  },
  goalOrderButtonIcon: {
    fontSize: 13,
    color: '#61725D',
    fontWeight: '500',
  },
  goalOrderButtonLabel: {
    fontSize: 10,
    color: '#61725D',
    fontWeight: '500',
  },
  detailProgressTrack: {
    width: '100%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#D8E3CB',
    overflow: 'hidden',
  },
  detailProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#7FA36B',
  },
  detailWaterRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailWaterLabel: {
    fontSize: 14,
    color: '#70806B',
  },
  detailWaterCount: {
    fontSize: 22,
    fontWeight: '700',
    color: '#254336',
  },
  detailHint: {
    fontSize: 13,
    lineHeight: 20,
    color: '#70806B',
    textAlign: 'center',
  },
});