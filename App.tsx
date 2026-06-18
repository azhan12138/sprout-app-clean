import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DimensionValue } from 'react-native';

import { initialState } from './src/data/seed';
import { loadAppState, saveAppState } from './src/storage/appStorage';
import type { AppState, DailyMoodEntry, Goal, MoodKey, TabKey, Task, TaskRecurrence, WaterEvent } from './src/types';
import { formatDateKey, formatDisplayDate, getDateKeyFromIso, getRelativeDayLabel } from './src/utils/date';
import { createGoal, createTask, createWaterEvent, getGoalProgress, getPlantStage, getTaskPeriodKey, getWaterDrops, isTaskCompleteForToday } from './src/utils/goals';

type TaskModalMode = 'create' | 'edit';
type AiMode = 'today' | 'goal' | 'review';
type AiChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type AiPlanDraft = { goal?: { name: string; totalSteps: number; currentSteps: number }; tasks: Array<{ id: string; content: string; recurrence: TaskRecurrence }>; summary: string };
type AiSettings = { baseUrl: string; model: string; hasApiKey: boolean };
type DailyReviewItem = { date: string; mood: DailyMoodEntry | null; completedTasks: Task[]; waterEvents: WaterEvent[] };

const AI_API_KEY_STORAGE_KEY = 'sprout-siliconflow-api-key';
const AI_BASE_URL_STORAGE_KEY = 'sprout-siliconflow-base-url';
const AI_MODEL_STORAGE_KEY = 'sprout-siliconflow-model';
const DEFAULT_AI_BASE_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_AI_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const plantStageImages = {
  seed: require('./assets/plants/plant-seed.png'),
  sprout: require('./assets/plants/plant-sprout.png'),
  leaf: require('./assets/plants/plant-leaf.png'),
  bloom: require('./assets/plants/plant-bloom.png'),
};

const moodOptions: Array<{ key: MoodKey; emoji: string; label: string }> = [
  { key: 'happy', emoji: '😃', label: '开心' },
  { key: 'calm', emoji: '😌', label: '平静' },
  { key: 'neutral', emoji: '😐', label: '普通' },
  { key: 'tired', emoji: '😮‍💨', label: '疲惫' },
  { key: 'anxious', emoji: '😟', label: '焦虑' },
  { key: 'hopeful', emoji: '🌿', label: '有希望' },
];

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

const createId = () => String(Date.now()) + '-' + Math.random().toString(16).slice(2, 8);
const getMoodMeta = (mood: MoodKey) => moodOptions.find((option) => option.key === mood) ?? moodOptions[0];
const getRecurrenceText = (recurrence: TaskRecurrence) => recurrence === 'daily' ? '每日' : recurrence === 'weekly' ? '每周' : '一次';
const getDailySummaryText = (item: DailyReviewItem) => (item.mood ? getMoodMeta(item.mood.mood).emoji + ' ' + getMoodMeta(item.mood.mood).label : '未记录心情') + ' · 完成 ' + item.completedTasks.length + ' 个任务 · 浇水 ' + item.waterEvents.length + ' 次';

const extractJsonObject = (value: string) => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object found');
  return JSON.parse(value.slice(start, end + 1)) as Partial<AiPlanDraft>;
};

const normalizeAiDraft = (raw: Partial<AiPlanDraft>): AiPlanDraft => ({
  goal: raw.goal?.name ? { name: String(raw.goal.name), totalSteps: Number.isInteger(raw.goal.totalSteps) && raw.goal.totalSteps > 0 ? raw.goal.totalSteps : 7, currentSteps: Number.isFinite(raw.goal.currentSteps) && raw.goal.currentSteps >= 0 ? Math.floor(raw.goal.currentSteps) : 0 } : undefined,
  tasks: (raw.tasks ?? []).filter((task) => task?.content).map((task) => ({ id: task.id ?? createId(), content: String(task.content), recurrence: ['none', 'daily', 'weekly'].includes(task.recurrence ?? '') ? task.recurrence ?? 'none' : 'none' })),
  summary: raw.summary ? String(raw.summary) : '我先帮你生成了一份可以编辑的计划草案。',
});

const createSampleDraft = (mode: AiMode, seedText = ''): AiPlanDraft => mode === 'review' ? {
  tasks: [
    { id: createId(), content: '明天保留一个 15 分钟最小行动', recurrence: 'daily' },
    { id: createId(), content: '睡前写一句今日复盘', recurrence: 'daily' },
  ],
  summary: '今天已经有行动痕迹了，明天建议继续保持轻量，不要把计划做重。',
} : {
  goal: mode === 'goal' ? { name: seedText.trim() ? seedText.trim().slice(0, 18) : '新的成长目标', totalSteps: 7, currentSteps: 0 } : undefined,
  tasks: [
    { id: createId(), content: '写下这件事为什么重要', recurrence: 'none' },
    { id: createId(), content: '完成 20 分钟最小行动', recurrence: 'daily' },
    { id: createId(), content: '周末回顾一次进展并调整计划', recurrence: 'weekly' },
  ],
  summary: '我先拆成一个轻量计划，你可以修改后再应用。',
};

const buildAiPrompt = (mode: AiMode, userText: string, appState: AppState, dateKey: string) => {
  const goals = appState.goals.filter((goal) => goal.archivedAt === null).map((goal) => ({ name: goal.name, currentSteps: goal.currentSteps, totalSteps: goal.totalSteps }));
  const tasks = appState.tasks.filter((task) => !isTaskCompleteForToday(task)).slice(0, 8).map((task) => ({ content: task.content, recurrence: task.recurrence }));
  const done = appState.tasks.filter((task) => task.completedAt && getDateKeyFromIso(task.completedAt) === dateKey).map((task) => task.content);
  const mood = appState.dailyMoods[dateKey] ?? null;
  return [
    '你是 Sprout 应用里的计划助手。请用温和、具体、可执行的中文帮助用户制定计划。',
    '必须只返回一个 JSON 对象，不要 Markdown，不要代码块。JSON 类型：{"goal":{"name":"目标名","totalSteps":7,"currentSteps":0},"tasks":[{"content":"任务内容","recurrence":"none|daily|weekly"}],"summary":"一句解释"}',
    '如果只是安排今天，可以不返回 goal；如果用户要拆大目标，需要返回 goal。任务数量 2 到 6 个。',
    '模式：' + mode,
    '用户输入：' + userText,
    '今日：' + dateKey,
    '当前目标：' + JSON.stringify(goals),
    '未完成任务：' + JSON.stringify(tasks),
    '今日完成：' + JSON.stringify(done),
    '今日心情：' + (mood ? mood.mood + ' ' + mood.note : '未记录'),
  ].join('\n');
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
  const [taskModalMode, setTaskModalMode] = useState<TaskModalMode>('edit');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEditInput, setTaskEditInput] = useState('');
  const [taskEditRecurrence, setTaskEditRecurrence] = useState<TaskRecurrence>('none');
  const [rewardTaskId, setRewardTaskId] = useState<string | null>(null);
  const [moodNoteInput, setMoodNoteInput] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiSettingsVisible, setAiSettingsVisible] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>('today');
  const [aiPromptInput, setAiPromptInput] = useState('');
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([{ id: createId(), role: 'assistant', content: '告诉我你想推进的大目标、今天可用时间，或直接说“帮我安排今天”。我会先生成草案，你可以修改后再应用。', createdAt: new Date().toISOString() }]);
  const [aiDraft, setAiDraft] = useState<AiPlanDraft | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>({ baseUrl: DEFAULT_AI_BASE_URL, model: DEFAULT_AI_MODEL, hasApiKey: false });
  const [aiApiKeyInput, setAiApiKeyInput] = useState('');
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState(DEFAULT_AI_BASE_URL);
  const [aiModelInput, setAiModelInput] = useState(DEFAULT_AI_MODEL);
  const [aiIsLoading, setAiIsLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const taskRewardScale = useRef(new Animated.Value(1)).current;
  const taskRewardOpacity = useRef(new Animated.Value(0)).current;
  const plantScale = useRef(new Animated.Value(1)).current;
  const plantRotate = useRef(new Animated.Value(0)).current;
  const waterDropY = useRef(new Animated.Value(0)).current;
  const waterDropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      const storedState = await loadAppState();
      const apiKey = await SecureStore.getItemAsync(AI_API_KEY_STORAGE_KEY);
      const baseUrl = (await SecureStore.getItemAsync(AI_BASE_URL_STORAGE_KEY)) ?? DEFAULT_AI_BASE_URL;
      const model = (await SecureStore.getItemAsync(AI_MODEL_STORAGE_KEY)) ?? DEFAULT_AI_MODEL;
      if (mounted && storedState) {
        setAppState(storedState);
        setMoodNoteInput(storedState.dailyMoods[formatDateKey()]?.note ?? '');
      }
      if (mounted) {
        setAiSettings({ baseUrl, model, hasApiKey: Boolean(apiKey) });
        setAiBaseUrlInput(baseUrl);
        setAiModelInput(model);
        setIsReady(true);
      }
    };
    bootstrap();
    return () => { mounted = false; };
  }, []);

  useEffect(() => { if (isReady) saveAppState(appState); }, [appState, isReady]);

  const todayKey = formatDateKey();
  const waterDrops = useMemo(() => getWaterDrops(appState), [appState]);
  const todayMood = appState.dailyMoods[todayKey] ?? null;
  const detailGoal = appState.goals.find((goal) => goal.id === goalDetailGoalId) ?? null;
  const detailGoalIndex = detailGoal ? appState.goals.findIndex((goal) => goal.id === detailGoal.id) : -1;
  const detailPlantStage = detailGoal ? getPlantStage(detailGoal) : null;

  useEffect(() => { setMoodNoteInput(todayMood?.note ?? ''); }, [todayMood?.note, todayKey]);

  const visibleGoals = useMemo(() => appState.goals.filter((goal) => showArchivedGoals || goal.archivedAt === null), [appState.goals, showArchivedGoals]);
  const todayTasks = useMemo(() => [...appState.tasks].sort((left, right) => {
    const leftDone = isTaskCompleteForToday(left);
    const rightDone = isTaskCompleteForToday(right);
    if (leftDone !== rightDone) return leftDone ? 1 : -1;
    if (left.recurrence !== right.recurrence) return left.recurrence === 'none' ? 1 : -1;
    return right.updatedAt.localeCompare(left.updatedAt);
  }), [appState.tasks, todayKey]);
  const reviewItems = useMemo<DailyReviewItem[]>(() => {
    const keys = new Set<string>();
    Object.keys(appState.dailyMoods).forEach((key) => keys.add(key));
    appState.tasks.forEach((task) => { if (task.completedAt) keys.add(getDateKeyFromIso(task.completedAt)); });
    appState.waterEvents.forEach((event) => keys.add(getDateKeyFromIso(event.createdAt)));
    return Array.from(keys).sort((a, b) => b.localeCompare(a)).map((date) => ({ date, mood: appState.dailyMoods[date] ?? null, completedTasks: appState.tasks.filter((task) => task.completedAt && getDateKeyFromIso(task.completedAt) === date), waterEvents: appState.waterEvents.filter((event) => getDateKeyFromIso(event.createdAt) === date) }));
  }, [appState.dailyMoods, appState.tasks, appState.waterEvents]);

  const updateGoals = (updater: (goals: Goal[]) => Goal[]) => setAppState((current) => {
    const goals = updater(current.goals);
    return { ...current, goals, selectedGoalId: goals.find((goal) => goal.id === current.selectedGoalId)?.id ?? goals[0]?.id ?? null };
  });

  const resetGoalForm = () => { setGoalNameInput(''); setGoalStepsInput(''); setGoalProgressInput('0'); setEditingGoalId(null); };
  const handleOpenCreateGoalModal = () => { resetGoalForm(); setGoalModalVisible(true); };
  const handleCloseGoalModal = () => { setGoalModalVisible(false); resetGoalForm(); };
  const handleSaveGoal = () => {
    const name = goalNameInput.trim();
    const totalSteps = Number(goalStepsInput);
    const currentSteps = Number(goalProgressInput);
    if (!name || !Number.isInteger(totalSteps) || totalSteps <= 0 || Number.isNaN(currentSteps) || currentSteps < 0) { Alert.alert('还差一点', '请填写目标名称、有效总步数和当前进度。'); return; }
    if (editingGoalId) {
      updateGoals((goals) => goals.map((goal) => goal.id === editingGoalId ? { ...goal, name, totalSteps, currentSteps: Math.min(Math.floor(currentSteps), totalSteps) } : goal));
      setGoalDetailGoalId(editingGoalId);
    } else {
      const nextGoal = { ...createGoal(name, totalSteps), currentSteps: Math.min(Math.floor(currentSteps), totalSteps) };
      setAppState((current) => ({ ...current, goals: [...current.goals, nextGoal], selectedGoalId: nextGoal.id }));
      setGoalDetailGoalId(nextGoal.id);
    }
    handleCloseGoalModal();
    setActiveTab('habitat');
  };
  const handleOpenEditGoalModal = (goal: Goal) => { setGoalDetailGoalId(null); setEditingGoalId(goal.id); setGoalNameInput(goal.name); setGoalStepsInput(String(goal.totalSteps)); setGoalProgressInput(String(goal.currentSteps)); setGoalModalVisible(true); };
  const handleDeleteGoal = (goal: Goal) => Alert.alert('删除这个目标？', '“' + goal.name + '”会从栖息地里移除，对应浇水记录也会一起删除。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { updateGoals((goals) => goals.filter((item) => item.id !== goal.id)); setAppState((current) => ({ ...current, waterEvents: current.waterEvents.filter((event) => event.goalId !== goal.id) })); setGoalDetailGoalId(null); } }]);
  const handleMoveGoalToEdge = (goalId: string, edge: 'start' | 'end') => updateGoals((goals) => { const index = goals.findIndex((goal) => goal.id === goalId); if (index < 0) return goals; const next = [...goals]; const moved = next.splice(index, 1)[0]; edge === 'start' ? next.unshift(moved) : next.push(moved); return next; });
  const handleMoveGoalByOffset = (goalId: string, offset: -1 | 1) => updateGoals((goals) => { const index = goals.findIndex((goal) => goal.id === goalId); const target = index + offset; if (index < 0 || target < 0 || target >= goals.length) return goals; const next = [...goals]; const moved = next.splice(index, 1)[0]; next.splice(target, 0, moved); return next; });
  const handleToggleArchiveGoal = (goalId: string) => { updateGoals((goals) => goals.map((goal) => goal.id === goalId ? { ...goal, archivedAt: goal.archivedAt ? null : new Date().toISOString() } : goal)); setGoalDetailGoalId(goalId); };
  const handleOpenGoalDetail = (goalId: string) => { setAppState((current) => ({ ...current, selectedGoalId: goalId })); setGoalDetailGoalId(goalId); };

  const runPlantAnimation = () => {
    plantScale.setValue(1); plantRotate.setValue(0); waterDropY.setValue(0); waterDropOpacity.setValue(1);
    Animated.parallel([
      Animated.sequence([Animated.spring(plantScale, { toValue: 1.12, useNativeDriver: true, friction: 4 }), Animated.spring(plantScale, { toValue: 1, useNativeDriver: true, friction: 5 })]),
      Animated.sequence([Animated.timing(plantRotate, { toValue: 1, duration: 120, useNativeDriver: true }), Animated.timing(plantRotate, { toValue: -1, duration: 120, useNativeDriver: true }), Animated.timing(plantRotate, { toValue: 0, duration: 120, useNativeDriver: true })]),
      Animated.sequence([Animated.timing(waterDropY, { toValue: -34, duration: 360, useNativeDriver: true }), Animated.timing(waterDropOpacity, { toValue: 0, duration: 220, useNativeDriver: true })]),
    ]).start();
  };
  const handleWaterGoal = (goalId: string) => {
    const targetGoal = appState.goals.find((goal) => goal.id === goalId);
    if (!targetGoal || waterDrops <= 0 || targetGoal.currentSteps >= targetGoal.totalSteps) return;
    updateGoals((goals) => goals.map((goal) => goal.id === goalId ? { ...goal, currentSteps: Math.min(goal.currentSteps + 1, goal.totalSteps) } : goal));
    setAppState((current) => ({ ...current, waterEvents: [createWaterEvent(targetGoal), ...current.waterEvents] }));
    runPlantAnimation();
  };

  const resetTaskEditForm = () => { setEditingTaskId(null); setTaskEditInput(''); setTaskEditRecurrence('none'); setTaskModalMode('edit'); };
  const handleOpenCreateTaskModal = () => { setTaskModalMode('create'); setEditingTaskId(null); setTaskEditInput(''); setTaskEditRecurrence('none'); setTaskModalVisible(true); };
  const handleCollectWaterFromDetail = () => {
    setGoalDetailGoalId(null);
    setActiveTab('task');
    handleOpenCreateTaskModal();
  };
  const handleAddTask = () => { const content = taskInput.trim(); if (!content) return; setAppState((current) => ({ ...current, tasks: [createTask(content, taskRecurrenceInput), ...current.tasks] })); setTaskInput(''); setTaskRecurrenceInput('none'); };
  const runTaskRewardAnimation = (taskId: string) => { setRewardTaskId(taskId); taskRewardScale.setValue(0.9); taskRewardOpacity.setValue(1); Animated.parallel([Animated.sequence([Animated.spring(taskRewardScale, { toValue: 1.12, useNativeDriver: true, friction: 4 }), Animated.spring(taskRewardScale, { toValue: 1, useNativeDriver: true, friction: 5 })]), Animated.sequence([Animated.delay(280), Animated.timing(taskRewardOpacity, { toValue: 0, duration: 460, useNativeDriver: true })])]).start(() => setRewardTaskId(null)); };
  const handleToggleTask = (taskId: string) => {
    const now = new Date(); const nowIso = now.toISOString(); let shouldReward = false;
    setAppState((current) => ({ ...current, tasks: current.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const isCompleteNow = isTaskCompleteForToday(task, now); shouldReward = !isCompleteNow;
      if (task.recurrence === 'none') return { ...task, isCompleted: !task.isCompleted, completedAt: !task.isCompleted ? nowIso : null, lastCompletedAt: !task.isCompleted ? nowIso : null, updatedAt: nowIso, earnedDrops: Math.max(task.earnedDrops + (!task.isCompleted ? 1 : -1), 0) };
      if (isCompleteNow) return { ...task, isCompleted: false, updatedAt: nowIso, earnedDrops: Math.max(task.earnedDrops - 1, 0), lastCompletedAt: null };
      return { ...task, isCompleted: true, completedAt: nowIso, lastCompletedAt: nowIso, updatedAt: nowIso, earnedDrops: task.earnedDrops + 1 };
    }) }));
    if (shouldReward) runTaskRewardAnimation(taskId);
  };
  const handleOpenEditTaskModal = (task: Task) => { setTaskModalMode('edit'); setEditingTaskId(task.id); setTaskEditInput(task.content); setTaskEditRecurrence(task.recurrence); setTaskModalVisible(true); };
  const handleCloseTaskModal = () => { setTaskModalVisible(false); resetTaskEditForm(); };
  const handleSaveTask = () => { const content = taskEditInput.trim(); if (!content) return; if (taskModalMode === 'create') { setAppState((current) => ({ ...current, tasks: [createTask(content, taskEditRecurrence), ...current.tasks] })); handleCloseTaskModal(); Alert.alert('已添加今日任务', '去“劳作”完成它，就能获得一滴水。'); return; } if (!editingTaskId) return; setAppState((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === editingTaskId ? { ...task, content, recurrence: taskEditRecurrence, updatedAt: new Date().toISOString() } : task) })); handleCloseTaskModal(); };
  const handleDeleteTask = (task: Task) => Alert.alert('删除这个任务？', '“' + task.content + '”会从任务列表里移除。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => setAppState((current) => ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id) })) }]);

  const handleSelectMood = (mood: MoodKey) => setAppState((current) => ({ ...current, dailyMoods: { ...current.dailyMoods, [todayKey]: { date: todayKey, mood, note: current.dailyMoods[todayKey]?.note ?? moodNoteInput } } }));
  const handleChangeMoodNote = (note: string) => { setMoodNoteInput(note); setAppState((current) => ({ ...current, dailyMoods: { ...current.dailyMoods, [todayKey]: { date: todayKey, mood: current.dailyMoods[todayKey]?.mood ?? 'calm', note } } })); };

  const openAiAssistant = (mode: AiMode) => { setAiMode(mode); setAiError(''); setAiModalVisible(true); setAiPromptInput(mode === 'review' ? '请根据我今天的心情、完成任务和浇水记录，总结今天，并给一个明天建议。' : ''); };
  const handleOpenAiSettings = async () => { const apiKey = await SecureStore.getItemAsync(AI_API_KEY_STORAGE_KEY); setAiApiKeyInput(apiKey ?? ''); setAiBaseUrlInput(aiSettings.baseUrl); setAiModelInput(aiSettings.model); setAiSettingsVisible(true); };
  const handleSaveAiSettings = async () => { const apiKey = aiApiKeyInput.trim(); const baseUrl = aiBaseUrlInput.trim() || DEFAULT_AI_BASE_URL; const model = aiModelInput.trim() || DEFAULT_AI_MODEL; if (apiKey) await SecureStore.setItemAsync(AI_API_KEY_STORAGE_KEY, apiKey); else await SecureStore.deleteItemAsync(AI_API_KEY_STORAGE_KEY); await SecureStore.setItemAsync(AI_BASE_URL_STORAGE_KEY, baseUrl); await SecureStore.setItemAsync(AI_MODEL_STORAGE_KEY, model); setAiSettings({ baseUrl, model, hasApiKey: Boolean(apiKey) }); setAiSettingsVisible(false); };
  const handleGenerateAiDraft = async () => {
    const userText = aiPromptInput.trim(); if (!userText) { Alert.alert('先说一点想法', '告诉 AI 你的目标、时间限制，或者今天想完成什么。'); return; }
    setAiMessages((messages) => [...messages, { id: createId(), role: 'user', content: userText, createdAt: new Date().toISOString() }]); setAiError('');
    const apiKey = await SecureStore.getItemAsync(AI_API_KEY_STORAGE_KEY); if (!apiKey) { setAiError('还没有配置 API Key。你可以先配置，或使用示例草案体验流程。'); return; }
    setAiIsLoading(true);
    try {
      const response = await fetch(aiSettings.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ model: aiSettings.model, messages: [{ role: 'user', content: buildAiPrompt(aiMode, userText, appState, todayKey) }], temperature: 0.7 }) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const draft = normalizeAiDraft(extractJsonObject(data.choices?.[0]?.message?.content ?? ''));
      setAiDraft(draft); setAiMessages((messages) => [...messages, { id: createId(), role: 'assistant', content: draft.summary, createdAt: new Date().toISOString() }]); setAiPromptInput('');
    } catch (error) { console.warn('Failed to generate AI draft', error); setAiError('AI 请求失败或返回格式不稳定。请重试，或先使用示例草案。'); } finally { setAiIsLoading(false); }
  };
  const handleUseSampleDraft = () => { const draft = createSampleDraft(aiMode, aiPromptInput); setAiDraft(draft); setAiMessages((messages) => [...messages, { id: createId(), role: 'assistant', content: draft.summary, createdAt: new Date().toISOString() }]); };
  const updateAiDraftGoal = (field: 'name' | 'totalSteps' | 'currentSteps', value: string) => setAiDraft((draft) => draft ? { ...draft, goal: { ...(draft.goal ?? { name: '', totalSteps: 7, currentSteps: 0 }), [field]: field === 'name' ? value : Number(value) } } : draft);
  const updateAiDraftTask = (taskId: string, field: 'content' | 'recurrence', value: string) => setAiDraft((draft) => draft ? { ...draft, tasks: draft.tasks.map((task) => task.id === taskId ? { ...task, [field]: field === 'recurrence' ? value as TaskRecurrence : value } : task) } : draft);
  const handleAddDraftTask = () => setAiDraft((draft) => ({ goal: draft?.goal, summary: draft?.summary ?? '', tasks: [...(draft?.tasks ?? []), { id: createId(), content: '新的任务', recurrence: 'none' }] }));
  const handleRemoveDraftTask = (taskId: string) => setAiDraft((draft) => draft ? { ...draft, tasks: draft.tasks.filter((task) => task.id !== taskId) } : draft);
  const handleApplyDraft = () => {
    if (!aiDraft) return;
    const validTasks = aiDraft.tasks.filter((task) => task.content.trim()); const goalDraft = aiDraft.goal?.name.trim() ? aiDraft.goal : undefined;
    if (goalDraft && (!Number.isInteger(goalDraft.totalSteps) || goalDraft.totalSteps <= 0 || !Number.isFinite(goalDraft.currentSteps) || goalDraft.currentSteps < 0 || goalDraft.currentSteps > goalDraft.totalSteps)) { Alert.alert('草案还不能应用', '请确认目标总步数为正整数，当前进度不能超过总步数。'); return; }
    if (!goalDraft && validTasks.length === 0) { Alert.alert('草案还不能应用', '至少保留一个目标或任务。'); return; }
    const nextGoal = goalDraft ? { ...createGoal(goalDraft.name.trim(), goalDraft.totalSteps), currentSteps: Math.floor(goalDraft.currentSteps) } : null;
    setAppState((current) => ({ ...current, goals: nextGoal ? [...current.goals, nextGoal] : current.goals, selectedGoalId: nextGoal?.id ?? current.selectedGoalId, tasks: [...validTasks.map((task) => createTask(task.content.trim(), task.recurrence)), ...current.tasks] }));
    setAiDraft(null); setAiModalVisible(false); setActiveTab(nextGoal ? 'habitat' : 'task'); if (nextGoal) setGoalDetailGoalId(nextGoal.id);
  };

  const plantRotateInterpolate = plantRotate.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-4deg', '0deg', '4deg'] });
  const waterHint = waterDrops > 0 ? '选一株正在成长的植物，给它一滴今天行动换来的水。' : '再完成 1 个任务，就能继续浇水。';
  const renderPlant = (goal: Goal, size: 'small' | 'large' = 'small', animated = false) => {
    const progress = getGoalProgress(goal);
    const stage = progress >= 1 ? 'bloom' : progress > 0.5 ? 'leaf' : progress > 0.25 ? 'sprout' : 'seed';
    const isLarge = size === 'large';
    const Wrapper = (animated ? Animated.View : View) as any;
    const animatedStyle = animated ? { transform: [{ scale: plantScale }, { rotate: plantRotateInterpolate }] } : undefined;

    return (
      <Wrapper style={[styles.plantCanvas, isLarge && styles.plantCanvasLarge, animatedStyle]}>
        <Image source={plantStageImages[stage]} style={[styles.plantImage, isLarge && styles.plantImageLarge]} resizeMode="contain" />
      </Wrapper>
    );
  };
  const renderGoalTile = (goal: Goal) => { const stage = getPlantStage(goal); const pct = Math.round(getGoalProgress(goal) * 100); return <View key={goal.id} style={styles.goalTileColumn}><Pressable style={styles.goalTile} onPress={() => handleOpenGoalDetail(goal.id)}><View style={styles.goalPlantFrame}>{renderPlant(goal)}</View><Text style={styles.goalTileName} numberOfLines={1}>{goal.name}</Text><Text style={styles.goalTileMeta}>{stage.label} · {goal.currentSteps} / {goal.totalSteps}</Text><View style={styles.goalBadgeSlot}>{goal.archivedAt ? <Text style={styles.goalBadge}>已归档</Text> : null}</View><View style={styles.goalTileTrack}><View style={[styles.goalTileFill, { width: `${pct}%` as DimensionValue }]} /></View></Pressable></View>; };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.keyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
        <View style={styles.appShell}>
          <View style={styles.headerBlock}><Text style={styles.appTitle}>芽 Sprout</Text><Text style={styles.appSubtitle}>今天做一点，梦想就会长一点</Text></View>
          <View style={styles.tabBar}><TabButton label="栖息地" isActive={activeTab === 'habitat'} onPress={() => setActiveTab('habitat')} /><TabButton label="劳作" isActive={activeTab === 'task'} onPress={() => setActiveTab('task')} /><TabButton label="回顾" isActive={activeTab === 'review'} onPress={() => setActiveTab('review')} /></View>
          <View style={styles.pageSlot}>
            {activeTab === 'habitat' ? <HabitatView waterDrops={waterDrops} waterHint={waterHint} showArchivedGoals={showArchivedGoals} setShowArchivedGoals={setShowArchivedGoals} visibleGoals={visibleGoals} renderGoalTile={renderGoalTile} openGoal={handleOpenCreateGoalModal} openTask={handleOpenCreateTaskModal} /> : null}
            {activeTab === 'task' ? <TaskView waterDrops={waterDrops} taskRewardOpacity={taskRewardOpacity} taskRewardScale={taskRewardScale} openAi={() => openAiAssistant('today')} taskInput={taskInput} setTaskInput={setTaskInput} handleAddTask={handleAddTask} taskRecurrenceInput={taskRecurrenceInput} setTaskRecurrenceInput={setTaskRecurrenceInput} todayTasks={todayTasks} rewardTaskId={rewardTaskId} handleToggleTask={handleToggleTask} handleOpenEditTaskModal={handleOpenEditTaskModal} /> : null}
            {activeTab === 'review' ? <ReviewView todayMood={todayMood} moodNoteInput={moodNoteInput} handleChangeMoodNote={handleChangeMoodNote} handleSelectMood={handleSelectMood} openAi={() => openAiAssistant('review')} reviewItems={reviewItems} todayKey={todayKey} /> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
      {renderDetailModal()}
      {renderGoalModal()}
      {renderTaskModal()}
      {renderAiSettingsModal()}
      {renderAiModal()}
    </SafeAreaView>
  );

  function renderDetailModal() {
    const detailPercent = detailGoal ? Math.round(getGoalProgress(detailGoal) * 100) : 0;
    const canMoveBack = detailGoalIndex > 0;
    const canMoveForward = detailGoalIndex >= 0 && detailGoalIndex < appState.goals.length - 1;

    return (
      <Modal animationType="fade" transparent visible={goalDetailGoalId !== null && detailGoal !== null} onRequestClose={() => setGoalDetailGoalId(null)}>
        <KeyboardAvoidingView style={styles.modalKeyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBackdrop}>
            <View style={styles.detailModalCard}>
              <View style={styles.detailTopBar}>
                <Text style={styles.detailKicker}>植物详情</Text>
                <Pressable style={styles.detailCloseButton} onPress={() => setGoalDetailGoalId(null)}>
                  <Text style={styles.detailCloseButtonText}>×</Text>
                </Pressable>
              </View>

              <View style={styles.detailPlantStageCard}>
                <View style={styles.detailHeroCenter}>
                  {detailGoal ? renderPlant(detailGoal, 'large', true) : null}
                  <Animated.Text style={[styles.waterDropOverlay, { opacity: waterDropOpacity, transform: [{ translateY: waterDropY }] }]}>💧</Animated.Text>
                  <Text style={styles.detailGoalName}>{detailGoal?.name}</Text>
                  <Text style={styles.detailGoalStage}>{detailPlantStage?.label}</Text>
                </View>
              </View>

              <View style={styles.goalOrderInlineRow}>
                <SmallButton icon="⇤" label="最前" disabled={!canMoveBack} onPress={() => detailGoal && handleMoveGoalToEdge(detailGoal.id, 'start')} />
                <SmallButton icon="←" label="前移" disabled={!canMoveBack} onPress={() => detailGoal && handleMoveGoalByOffset(detailGoal.id, -1)} />
                <SmallButton icon="→" label="后移" disabled={!canMoveForward} onPress={() => detailGoal && handleMoveGoalByOffset(detailGoal.id, 1)} />
                <SmallButton icon="⇥" label="最后" disabled={!canMoveForward} onPress={() => detailGoal && handleMoveGoalToEdge(detailGoal.id, 'end')} />
              </View>

              <View style={styles.detailProgressHeader}>
                <Text style={styles.detailGoalMeta}>{detailGoal?.currentSteps} / {detailGoal?.totalSteps}</Text>
                <Text style={styles.detailGoalMeta}>{detailPercent}%</Text>
              </View>
              <View style={styles.detailProgressTrack}>
                <View style={[styles.detailProgressFill, { width: `${detailPercent}%` as DimensionValue }]} />
              </View>

              <View style={styles.detailModalActions}>
                <Pressable style={[styles.secondaryButton, styles.detailActionButton]} onPress={() => detailGoal && handleOpenEditGoalModal(detailGoal)}><Text style={styles.secondaryButtonText}>编辑目标</Text></Pressable>
                <Pressable style={[styles.secondaryButton, styles.detailActionButton, styles.dangerButton]} onPress={() => detailGoal && handleDeleteGoal(detailGoal)}><Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>删除目标</Text></Pressable>
              </View>
              {detailGoal && detailGoal.currentSteps >= detailGoal.totalSteps ? <Pressable style={styles.archiveButton} onPress={() => handleToggleArchiveGoal(detailGoal.id)}><Text style={styles.archiveButtonText}>{detailGoal.archivedAt ? '取消归档' : '归档这朵花'}</Text></Pressable> : null}

              <View style={styles.detailWaterRow}>
                <Text style={styles.detailWaterLabel}>可用水滴</Text>
                <Text style={styles.detailWaterCount}>{waterDrops} 💧</Text>
              </View>
              <PrimaryButton label={detailGoal && detailGoal.currentSteps >= detailGoal.totalSteps ? '已开花' : waterDrops > 0 ? '浇水 +1' : '先去收集水滴'} disabled={!detailGoal || detailGoal.currentSteps >= detailGoal.totalSteps} onPress={() => detailGoal && (waterDrops > 0 ? handleWaterGoal(detailGoal.id) : handleCollectWaterFromDetail())} />
              <Text style={styles.detailHint}>今天的小事，正在让它慢慢长大。</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }
  function renderGoalModal() {
    return <Modal animationType="slide" transparent visible={goalModalVisible} onRequestClose={handleCloseGoalModal}><KeyboardAvoidingView style={styles.modalKeyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>{editingGoalId ? '编辑目标' : '播种新目标'}</Text><Text style={styles.modalText}>{editingGoalId ? '调整这颗种子的名字、步数和当前进度。' : '先写下一个你愿意慢慢养大的目标。'}</Text><TextInput value={goalNameInput} onChangeText={setGoalNameInput} placeholder="目标名称" placeholderTextColor="#7B8D78" style={styles.modalInput} /><TextInput value={goalStepsInput} onChangeText={setGoalStepsInput} placeholder="总步数，例如 21" placeholderTextColor="#7B8D78" keyboardType="number-pad" style={styles.modalInput} /><TextInput value={goalProgressInput} onChangeText={setGoalProgressInput} placeholder="当前进度，例如 3" placeholderTextColor="#7B8D78" keyboardType="number-pad" style={styles.modalInput} /><View style={styles.modalActions}>{!editingGoalId ? <Pressable style={styles.secondaryButton} onPress={() => openAiAssistant('goal')}><Text style={styles.secondaryButtonText}>AI 帮我拆计划</Text></Pressable> : null}<Pressable style={styles.secondaryButton} onPress={handleCloseGoalModal}><Text style={styles.secondaryButtonText}>取消</Text></Pressable><Pressable style={styles.primaryButton} onPress={handleSaveGoal}><Text style={styles.primaryButtonText}>{editingGoalId ? '保存' : '创建'}</Text></Pressable></View></View></View></KeyboardAvoidingView></Modal>;
  }
  function renderTaskModal() {
    return <Modal animationType="slide" transparent visible={taskModalVisible} onRequestClose={handleCloseTaskModal}><KeyboardAvoidingView style={styles.modalKeyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>{taskModalMode === 'create' ? '添加今日任务' : '编辑任务'}</Text><Text style={styles.modalText}>{taskModalMode === 'create' ? '先安排一件小事，完成后就能获得水滴。' : '调整任务内容，或者把它改成每日 / 每周的小习惯。'}</Text><TextInput value={taskEditInput} onChangeText={setTaskEditInput} placeholder="任务内容" placeholderTextColor="#7B8D78" style={styles.modalInput} /><View style={styles.filterRow}>{recurrenceMeta.map((option) => <FilterChip key={option.key} label={option.label} isActive={taskEditRecurrence === option.key} onPress={() => setTaskEditRecurrence(option.key)} />)}</View><View style={styles.modalActions}>{taskModalMode === 'edit' ? <Pressable style={[styles.secondaryButton, styles.dangerButton]} onPress={() => { const targetTask = appState.tasks.find((task) => task.id === editingTaskId); if (targetTask) { handleCloseTaskModal(); handleDeleteTask(targetTask); } }}><Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>删除</Text></Pressable> : null}<Pressable style={styles.secondaryButton} onPress={handleCloseTaskModal}><Text style={styles.secondaryButtonText}>取消</Text></Pressable><Pressable style={styles.primaryButton} onPress={handleSaveTask}><Text style={styles.primaryButtonText}>保存</Text></Pressable></View></View></View></KeyboardAvoidingView></Modal>;
  }
  function renderAiSettingsModal() {
    return <Modal animationType="slide" transparent visible={aiSettingsVisible} onRequestClose={() => setAiSettingsVisible(false)}><KeyboardAvoidingView style={styles.modalKeyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>AI 设置</Text><Text style={styles.modalText}>配置硅基流动 API Key、接口地址和模型名。Key 不会硬编码进代码。</Text><TextInput value={aiApiKeyInput} onChangeText={setAiApiKeyInput} placeholder="SiliconFlow API Key" placeholderTextColor="#7B8D78" secureTextEntry style={styles.modalInput} /><TextInput value={aiBaseUrlInput} onChangeText={setAiBaseUrlInput} placeholder="Base URL" placeholderTextColor="#7B8D78" autoCapitalize="none" style={styles.modalInput} /><TextInput value={aiModelInput} onChangeText={setAiModelInput} placeholder="模型名" placeholderTextColor="#7B8D78" autoCapitalize="none" style={styles.modalInput} /><View style={styles.modalActions}><Pressable style={styles.secondaryButton} onPress={() => setAiSettingsVisible(false)}><Text style={styles.secondaryButtonText}>取消</Text></Pressable><Pressable style={styles.primaryButton} onPress={handleSaveAiSettings}><Text style={styles.primaryButtonText}>保存设置</Text></Pressable></View></View></View></KeyboardAvoidingView></Modal>;
  }
  function renderAiModal() {
    return <Modal animationType="slide" transparent visible={aiModalVisible} onRequestClose={() => setAiModalVisible(false)}><KeyboardAvoidingView style={styles.modalKeyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.modalBackdrop}><ScrollView style={styles.aiModalCard} contentContainerStyle={styles.aiModalContent}><View style={styles.aiHeaderRow}><View style={styles.aiHeaderTextWrap}><Text style={styles.modalTitle}>AI 计划助手</Text><Text style={styles.modalText}>先对话，再编辑草案；只有你点应用后才会写入目标和任务。</Text></View><Pressable style={styles.detailCloseButton} onPress={() => setAiModalVisible(false)}><Text style={styles.detailCloseButtonText}>×</Text></Pressable></View><View style={styles.aiStatusRow}><Text style={styles.aiStatusText}>{aiSettings.hasApiKey ? 'API Key 已配置' : '未配置 API Key'}</Text><Pressable style={styles.archiveToggle} onPress={handleOpenAiSettings}><Text style={styles.archiveToggleText}>AI 设置</Text></Pressable></View><View style={styles.chatLog}>{aiMessages.map((message) => <View key={message.id} style={[styles.chatBubble, message.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant]}><Text style={[styles.chatText, message.role === 'user' && styles.chatTextUser]}>{message.content}</Text></View>)}</View><TextInput value={aiPromptInput} onChangeText={setAiPromptInput} placeholder="例如：我想准备英语考试，每天只有 30 分钟。" placeholderTextColor="#7B8D78" multiline style={[styles.modalInput, styles.aiPromptInput]} />{aiError ? <Text style={styles.aiErrorText}>{aiError}</Text> : null}<View style={styles.modalActions}><Pressable style={styles.secondaryButton} onPress={handleUseSampleDraft}><Text style={styles.secondaryButtonText}>使用示例草案</Text></Pressable><Pressable style={[styles.primaryButton, aiIsLoading && styles.primaryButtonDisabled]} onPress={handleGenerateAiDraft} disabled={aiIsLoading}><Text style={styles.primaryButtonText}>{aiIsLoading ? '生成中...' : '生成计划草案'}</Text></Pressable></View>{aiDraft ? <DraftEditor draft={aiDraft} updateGoal={updateAiDraftGoal} updateTask={updateAiDraftTask} removeTask={handleRemoveDraftTask} addTask={handleAddDraftTask} cancel={() => setAiDraft(null)} apply={handleApplyDraft} /> : null}</ScrollView></View></KeyboardAvoidingView></Modal>;
  }
}

function HabitatView({ waterDrops, waterHint, showArchivedGoals, setShowArchivedGoals, visibleGoals, renderGoalTile, openGoal, openTask }: { waterDrops: number; waterHint: string; showArchivedGoals: boolean; setShowArchivedGoals: (value: boolean | ((value: boolean) => boolean)) => void; visibleGoals: Goal[]; renderGoalTile: (goal: Goal) => ReactNode; openGoal: () => void; openTask: () => void }) {
  return <ScrollView style={styles.pageScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" nestedScrollEnabled alwaysBounceVertical={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageContent}><View style={styles.waterSummaryCard}><View style={styles.waterCountBlock}><Text style={styles.waterSummaryLabel}>今日可用水滴</Text><View style={styles.waterNumberRow}><Text style={styles.waterSummaryCount}>{waterDrops}</Text><Text style={styles.waterDropIcon}>💧</Text></View></View><View style={styles.waterCopyBlock}><Text style={styles.waterSummaryHint}>{waterHint}</Text></View></View><View style={styles.quickActionRow}><Pressable style={styles.quickActionButton} onPress={openGoal}><Text style={styles.quickActionIcon}>🌱</Text><Text style={styles.quickActionTitle}>播种新目标</Text><Text style={styles.quickActionText}>把新的种子放进栖息地。</Text></Pressable><Pressable style={styles.quickActionButton} onPress={openTask}><Text style={styles.quickActionIcon}>✓</Text><Text style={styles.quickActionTitle}>添加今日任务</Text><Text style={styles.quickActionText}>先安排一件小事，完成后获得水滴。</Text></Pressable></View><View style={styles.sectionCard}><View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>我的栖息地</Text><Text style={styles.sectionText}>点开一株植物，看看它今天能长多高。</Text></View><View style={styles.archiveRow}><Pressable style={[styles.archiveToggle, showArchivedGoals && styles.archiveToggleActive]} onPress={() => setShowArchivedGoals((value) => !value)}><Text style={[styles.archiveToggleText, showArchivedGoals && styles.archiveToggleTextActive]}>{showArchivedGoals ? '隐藏归档' : '显示归档'}</Text></Pressable></View>{visibleGoals.length === 0 ? <View style={styles.emptyTaskState}><Text style={styles.emptyTaskTitle}>栖息地还很安静</Text><Text style={styles.emptyTaskText}>先播下一颗种子，或者把归档的花翻出来看看。</Text></View> : <View style={styles.goalGrid}>{visibleGoals.map(renderGoalTile)}</View>}</View></ScrollView>;
}

function TaskView({ waterDrops, taskRewardOpacity, taskRewardScale, openAi, taskInput, setTaskInput, handleAddTask, taskRecurrenceInput, setTaskRecurrenceInput, todayTasks, rewardTaskId, handleToggleTask, handleOpenEditTaskModal }: { waterDrops: number; taskRewardOpacity: Animated.Value; taskRewardScale: Animated.Value; openAi: () => void; taskInput: string; setTaskInput: (value: string) => void; handleAddTask: () => void; taskRecurrenceInput: TaskRecurrence; setTaskRecurrenceInput: (value: TaskRecurrence) => void; todayTasks: Task[]; rewardTaskId: string | null; handleToggleTask: (id: string) => void; handleOpenEditTaskModal: (task: Task) => void }) {
  return <ScrollView style={styles.pageScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" nestedScrollEnabled alwaysBounceVertical={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageContent}><View style={styles.waterSummaryCard}><View style={styles.waterCountBlock}><Text style={styles.waterSummaryLabel}>劳作获得的水滴</Text><View style={styles.waterNumberRow}><Text style={styles.waterSummaryCount}>{waterDrops}</Text><Text style={styles.waterDropIcon}>💧</Text></View></View><View style={styles.rewardArea}><Animated.Text style={[styles.rewardBurst, { opacity: taskRewardOpacity, transform: [{ scale: taskRewardScale }] }]}>+1 💧</Animated.Text><Text style={styles.waterSummaryHint}>水滴先回到这里，再去栖息地浇给目标。</Text></View></View><View style={styles.sectionCard}><View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>AI 帮我安排今天</Text><Text style={styles.sectionText}>说说今天的状态和时间，生成可编辑任务草案。</Text></View><PrimaryButton label="打开 AI 助手" onPress={openAi} /></View><View style={styles.sectionCard}><View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>今日任务</Text><Text style={styles.sectionText}>先完成一件小事，收集今天的水滴。</Text></View><View style={styles.inputRow}><TextInput value={taskInput} onChangeText={setTaskInput} placeholder="例如：看 10 分钟英语" placeholderTextColor="#7B8D78" style={styles.textInput} /><Pressable style={styles.addButton} onPress={handleAddTask}><Text style={styles.addButtonText}>添加</Text></Pressable></View><View style={styles.filterRow}>{recurrenceMeta.map((option) => <FilterChip key={option.key} label={option.label} isActive={taskRecurrenceInput === option.key} onPress={() => setTaskRecurrenceInput(option.key)} />)}</View>{todayTasks.length === 0 ? <View style={styles.emptyTaskState}><Text style={styles.emptyTaskTitle}>给自己安排一件小事吧</Text><Text style={styles.emptyTaskText}>从一个很轻的小动作开始，今天就能收集第一滴水。</Text></View> : todayTasks.map((task) => <TaskRow key={task.id} task={task} rewardTaskId={rewardTaskId} taskRewardScale={taskRewardScale} toggle={handleToggleTask} edit={handleOpenEditTaskModal} />)}</View></ScrollView>;
}

function TaskRow({ task, rewardTaskId, taskRewardScale, toggle, edit }: { task: Task; rewardTaskId: string | null; taskRewardScale: Animated.Value; toggle: (id: string) => void; edit: (task: Task) => void }) {
  const isCompleted = isTaskCompleteForToday(task);
  const currentPeriodKey = getTaskPeriodKey(task.recurrence);
  const lastPeriodKey = task.lastCompletedAt ? getTaskPeriodKey(task.recurrence, new Date(task.lastCompletedAt)) : null;
  const rewardText = task.recurrence === 'none' ? (isCompleted ? '+1 💧 已领取' : '完成后获得 1 💧') : (currentPeriodKey && currentPeriodKey === lastPeriodKey ? '本' + (task.recurrence === 'daily' ? '日' : '周') + '已领取 +1 💧' : '完成后获得本' + (task.recurrence === 'daily' ? '日' : '周') + ' 1 💧');
  return <Animated.View style={rewardTaskId === task.id ? { transform: [{ scale: taskRewardScale }] } : null}><Pressable style={[styles.taskItem, rewardTaskId === task.id && styles.taskItemReward]} onPress={() => toggle(task.id)} onLongPress={() => edit(task)}><View style={[styles.checkbox, isCompleted && styles.checkboxChecked]}>{isCompleted ? <Text style={styles.checkboxMark}>✓</Text> : null}</View><View style={styles.taskTextWrap}><Text style={[styles.taskText, isCompleted && styles.taskTextDone]}>{task.content}</Text><Text style={styles.taskReward}>{getRecurrenceText(task.recurrence)} · {rewardText}</Text></View></Pressable></Animated.View>;
}

function ReviewView({ todayMood, moodNoteInput, handleChangeMoodNote, handleSelectMood, openAi, reviewItems, todayKey }: { todayMood: DailyMoodEntry | null; moodNoteInput: string; handleChangeMoodNote: (note: string) => void; handleSelectMood: (mood: MoodKey) => void; openAi: () => void; reviewItems: DailyReviewItem[]; todayKey: string }) {
  return <ScrollView style={styles.pageScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" nestedScrollEnabled alwaysBounceVertical={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageContent}><View style={styles.moodCard}><View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>今天感觉怎么样？</Text><Text style={styles.sectionText}>把心情和今天完成的小事一起留存。</Text></View><View style={styles.moodRow}>{moodOptions.map((option) => { const isSelected = todayMood?.mood === option.key; return <Pressable key={option.key} style={[styles.moodChip, isSelected && styles.moodChipActive]} onPress={() => handleSelectMood(option.key)}><Text style={styles.moodEmoji}>{option.emoji}</Text><Text style={[styles.moodLabel, isSelected && styles.moodLabelActive]}>{option.label}</Text></Pressable>; })}</View><TextInput value={moodNoteInput} onChangeText={handleChangeMoodNote} placeholder="补一句今天的小备注（可选）" placeholderTextColor="#7B8D78" maxLength={40} style={styles.noteInput} />{todayMood ? <View style={styles.moodFeedbackCard}><Text style={styles.moodFeedbackText}>{moodFeedbackMap[todayMood.mood]}</Text></View> : null}<View style={styles.sectionSpacing}><PrimaryButton label="AI 总结今天" onPress={openAi} /></View></View><View style={styles.sectionCard}><View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>回顾</Text><Text style={styles.sectionText}>看看这些小事，怎样慢慢养大了你的目标。</Text></View></View>{reviewItems.length === 0 ? <View style={styles.sectionCard}><Text style={styles.emptyTaskTitle}>还没有可以回顾的记录</Text><Text style={styles.emptyTaskText}>先记录今天的心情，或者完成一件小事吧。</Text></View> : reviewItems.map((item) => <View key={item.date} style={styles.reviewCard}><Text style={styles.reviewDate}>{getRelativeDayLabel(item.date, todayKey)}</Text><Text style={styles.reviewDateSub}>{formatDisplayDate(item.date)}</Text><Text style={styles.reviewSummaryText}>{getDailySummaryText(item)}</Text>{item.mood?.note ? <Text style={styles.reviewNote}>“{item.mood.note}”</Text> : null}<View style={styles.reviewSection}><Text style={styles.reviewSectionTitle}>完成任务</Text>{item.completedTasks.length === 0 ? <Text style={styles.reviewEmptyText}>这一天还没有完成任务。</Text> : item.completedTasks.map((task) => <Text key={task.id} style={styles.reviewListItem}>· {task.content}（{getRecurrenceText(task.recurrence)}）</Text>)}</View><View style={styles.reviewSection}><Text style={styles.reviewSectionTitle}>目标推进</Text>{item.waterEvents.length === 0 ? <Text style={styles.reviewEmptyText}>这一天还没有浇水记录。</Text> : item.waterEvents.map((event) => <Text key={event.id} style={styles.reviewListItem}>· {event.goalNameSnapshot} +{event.amount}</Text>)}</View></View>)}</ScrollView>;
}

function DraftEditor({ draft, updateGoal, updateTask, removeTask, addTask, cancel, apply }: { draft: AiPlanDraft; updateGoal: (field: 'name' | 'totalSteps' | 'currentSteps', value: string) => void; updateTask: (id: string, field: 'content' | 'recurrence', value: string) => void; removeTask: (id: string) => void; addTask: () => void; cancel: () => void; apply: () => void }) {
  return <View style={styles.draftCard}><Text style={styles.sectionTitle}>可编辑计划草案</Text><Text style={styles.sectionText}>修改目标、步数和任务后，再应用到 App。</Text><TextInput value={draft.goal?.name ?? ''} onChangeText={(value) => updateGoal('name', value)} placeholder="目标名称（可选）" placeholderTextColor="#7B8D78" style={styles.modalInput} /><View style={styles.inputRow}><TextInput value={draft.goal ? String(draft.goal.totalSteps) : ''} onChangeText={(value) => updateGoal('totalSteps', value)} placeholder="总步数" placeholderTextColor="#7B8D78" keyboardType="number-pad" style={styles.textInput} /><TextInput value={draft.goal ? String(draft.goal.currentSteps) : ''} onChangeText={(value) => updateGoal('currentSteps', value)} placeholder="当前进度" placeholderTextColor="#7B8D78" keyboardType="number-pad" style={styles.textInput} /></View>{draft.tasks.map((task) => <View key={task.id} style={styles.draftTaskItem}><TextInput value={task.content} onChangeText={(value) => updateTask(task.id, 'content', value)} placeholder="任务内容" placeholderTextColor="#7B8D78" style={styles.draftTaskInput} /><View style={styles.filterRow}>{recurrenceMeta.map((option) => <FilterChip key={option.key} label={option.label} isActive={task.recurrence === option.key} onPress={() => updateTask(task.id, 'recurrence', option.key)} />)}</View><Pressable style={styles.inlineDangerButton} onPress={() => removeTask(task.id)}><Text style={styles.inlineDangerText}>删除这个任务</Text></Pressable></View>)}<Pressable style={styles.secondaryButton} onPress={addTask}><Text style={styles.secondaryButtonText}>添加任务</Text></Pressable><View style={styles.modalActions}><Pressable style={styles.secondaryButton} onPress={cancel}><Text style={styles.secondaryButtonText}>取消草案</Text></Pressable><Pressable style={styles.primaryButton} onPress={apply}><Text style={styles.primaryButtonText}>应用计划</Text></Pressable></View></View>;
}

function SmallButton({ icon, label, disabled, onPress }: { icon: string; label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable style={[styles.goalOrderButton, disabled && styles.goalOrderButtonDisabled]} disabled={disabled} onPress={onPress}><Text style={styles.goalOrderButtonIcon}>{icon}</Text><Text style={styles.goalOrderButtonLabel}>{label}</Text></Pressable>;
}

type TabButtonProps = { label: string; isActive: boolean; onPress: () => void };
function TabButton({ label, isActive, onPress }: TabButtonProps) { return <Pressable style={[styles.tabButton, isActive && styles.tabButtonActive]} onPress={onPress}><Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>{label}</Text></Pressable>; }
type FilterChipProps = { label: string; isActive: boolean; onPress: () => void };
function FilterChip({ label, isActive, onPress }: FilterChipProps) { return <Pressable style={[styles.filterChip, isActive && styles.filterChipActive]} onPress={onPress}><Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{label}</Text></Pressable>; }
type PrimaryButtonProps = { label: string; onPress: () => void; disabled?: boolean };
function PrimaryButton({ label, onPress, disabled = false }: PrimaryButtonProps) { return <Pressable style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]} disabled={disabled} onPress={onPress}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4F0E6', paddingTop: Platform.OS === 'android' ? 30 : 0 }, keyboardAvoidingView: { flex: 1 }, appShell: { flex: 1, paddingHorizontal: 18, paddingTop: 8 }, pageSlot: { flex: 1, minHeight: 0 }, pageScroll: { flex: 1 }, headerBlock: { marginBottom: 14 }, appTitle: { color: '#23462F', fontSize: 28, fontWeight: '900', letterSpacing: 0 }, appSubtitle: { color: '#687867', fontSize: 14, marginTop: 2 },
  tabBar: { flexDirection: 'row', backgroundColor: '#E4EADD', borderRadius: 18, padding: 4, marginBottom: 14 }, tabButton: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center' }, tabButtonActive: { backgroundColor: '#315F3D' }, tabButtonText: { color: '#5D715E', fontSize: 14, fontWeight: '800' }, tabButtonTextActive: { color: '#FFFFFF' }, pageContent: { paddingBottom: 160, gap: 14, flexGrow: 1 },
  waterSummaryCard: { backgroundColor: '#FFFDF8', borderRadius: 22, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, minHeight: 108, borderWidth: 1, borderColor: '#E7E1D2', shadowColor: '#2B4B32', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 }, waterCountBlock: { width: 112, justifyContent: 'center' }, waterSummaryLabel: { color: '#75806E', fontSize: 12, fontWeight: '900', lineHeight: 17 }, waterNumberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, waterSummaryCount: { color: '#274E34', fontSize: 34, fontWeight: '900', lineHeight: 39 }, waterDropIcon: { fontSize: 30, lineHeight: 34 }, waterCopyBlock: { flex: 1, justifyContent: 'center' }, waterSummaryHint: { color: '#717C6D', fontSize: 13, lineHeight: 21 }, rewardArea: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', gap: 4 }, rewardBurst: { color: '#2D8F5D', fontSize: 22, fontWeight: '900' },
  quickActionRow: { flexDirection: 'row', gap: 12 }, quickActionButton: { flex: 1, backgroundColor: '#FFFDF8', borderRadius: 20, padding: 15, minHeight: 118, justifyContent: 'space-between', borderWidth: 1, borderColor: '#E2E9DB', shadowColor: '#2B4B32', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 1 }, quickActionIcon: { fontSize: 24 }, quickActionTitle: { color: '#24412A', fontSize: 15, fontWeight: '900', lineHeight: 20 }, quickActionText: { color: '#75806E', fontSize: 12, lineHeight: 17 },
  sectionCard: { backgroundColor: '#FFFDF8', borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: '#E8E2D3' }, moodCard: { backgroundColor: '#FFFDF8', borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: '#E8E2D3' }, sectionHeaderRow: { gap: 5 }, sectionTitle: { color: '#24412A', fontSize: 17, fontWeight: '900', lineHeight: 23 }, sectionText: { color: '#717C6D', fontSize: 13, lineHeight: 19 }, sectionSpacing: { marginTop: 4 },
  archiveRow: { alignItems: 'flex-start' }, archiveToggle: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#EEF4EA' }, archiveToggleActive: { backgroundColor: '#315F3D' }, archiveToggleText: { color: '#315F3D', fontSize: 12, fontWeight: '800' }, archiveToggleTextActive: { color: '#FFFFFF' },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, goalTileColumn: { width: '47%' }, goalTile: { backgroundColor: '#FBFCF7', borderRadius: 20, padding: 12, height: 214, gap: 6, borderWidth: 1, borderColor: '#DFE8D9', justifyContent: 'space-between' }, goalPlantFrame: { height: 92, alignItems: 'center', justifyContent: 'center', marginTop: -2, marginBottom: 2 }, goalTileName: { color: '#24412A', fontSize: 14, fontWeight: '900', lineHeight: 18 }, goalTileMeta: { color: '#717C6D', fontSize: 11, fontWeight: '800', lineHeight: 15 }, goalBadgeSlot: { height: 24, justifyContent: 'center', alignItems: 'flex-start' }, goalBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#EFE7D0', color: '#8A6A2E', fontSize: 11, fontWeight: '900', overflow: 'hidden' }, goalTileTrack: { height: 7, backgroundColor: '#E4EBDC', borderRadius: 999, overflow: 'hidden' }, goalTileFill: { height: '100%', backgroundColor: '#77AD6A', borderRadius: 999 },
  plantCanvas: { height: 92, width: 112, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }, plantCanvasLarge: { height: 174, width: 194 }, plantImage: { width: 118, height: 118 }, plantImageLarge: { width: 210, height: 210 },
  inputRow: { flexDirection: 'row', gap: 10 }, textInput: { flex: 1, minHeight: 48, backgroundColor: '#F7FAF2', borderRadius: 15, paddingHorizontal: 14, color: '#24412A', borderWidth: 1, borderColor: '#E2EBDC' }, addButton: { borderRadius: 15, paddingHorizontal: 17, justifyContent: 'center', backgroundColor: '#315F3D' }, addButtonText: { color: '#FFFFFF', fontWeight: '900' }, filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filterChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#EEF4EA', borderWidth: 1, borderColor: '#DCE8D5' }, filterChipActive: { backgroundColor: '#315F3D', borderColor: '#315F3D' }, filterChipText: { color: '#315F3D', fontSize: 12, fontWeight: '900' }, filterChipTextActive: { color: '#FFFFFF' },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FBFCF7', borderRadius: 18, padding: 13, borderWidth: 1, borderColor: '#E1EAD9', marginTop: 8 }, taskItemReward: { backgroundColor: '#EAF7E7', borderColor: '#93C88E' }, checkbox: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#AABD9E', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDF8' }, checkboxChecked: { backgroundColor: '#315F3D', borderColor: '#315F3D' }, checkboxMark: { color: '#FFFFFF', fontWeight: '900' }, taskTextWrap: { flex: 1 }, taskText: { color: '#24412A', fontSize: 15, fontWeight: '900', lineHeight: 20 }, taskTextDone: { color: '#7C8B78', textDecorationLine: 'line-through' }, taskReward: { color: '#717C6D', fontSize: 12, marginTop: 4 }, emptyTaskState: { padding: 16, borderRadius: 18, backgroundColor: '#F8FBF5', gap: 6, borderWidth: 1, borderColor: '#E2EBDC' }, emptyTaskTitle: { color: '#24412A', fontSize: 16, fontWeight: '900' }, emptyTaskText: { color: '#717C6D', fontSize: 13, lineHeight: 19 },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, moodChip: { minWidth: 82, borderRadius: 18, padding: 10, alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4DFC9' }, moodChipActive: { borderColor: '#6EAD72', backgroundColor: '#EAF5E7' }, moodEmoji: { fontSize: 22 }, moodLabel: { color: '#6B7C68', fontSize: 12, fontWeight: '800', marginTop: 4 }, moodLabelActive: { color: '#315F3D' }, noteInput: { minHeight: 50, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, color: '#24412A' }, moodFeedbackCard: { borderRadius: 16, padding: 12, backgroundColor: '#F4EFD6' }, moodFeedbackText: { color: '#6F5C24', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  reviewCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, gap: 10 }, reviewDate: { color: '#24412A', fontSize: 18, fontWeight: '800' }, reviewDateSub: { color: '#7C8B78', fontSize: 12 }, reviewSummaryText: { color: '#315F3D', fontSize: 14, fontWeight: '800' }, reviewNote: { color: '#7A642D', fontSize: 13, lineHeight: 19 }, reviewSection: { gap: 5 }, reviewSectionTitle: { color: '#24412A', fontSize: 14, fontWeight: '800' }, reviewListItem: { color: '#6B7C68', fontSize: 13, lineHeight: 19 }, reviewEmptyText: { color: '#8C9888', fontSize: 13 },
  primaryButton: { borderRadius: 16, minHeight: 48, paddingVertical: 13, paddingHorizontal: 16, backgroundColor: '#315F3D', alignItems: 'center', justifyContent: 'center', shadowColor: '#315F3D', shadowOpacity: 0.13, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 }, primaryButtonDisabled: { opacity: 0.45 }, primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' }, secondaryButton: { borderRadius: 16, minHeight: 46, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#EEF4EA', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DCE8D5' }, secondaryButtonText: { color: '#315F3D', fontSize: 13, fontWeight: '900' }, dangerButton: { backgroundColor: '#FCECE9', borderColor: '#F3D1CC' }, dangerButtonText: { color: '#B34B43' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(25, 37, 26, 0.36)', justifyContent: 'center', padding: 18 }, modalKeyboardAvoidingView: { flex: 1 }, modalCard: { backgroundColor: '#FFFDF8', borderRadius: 24, padding: 18, gap: 12, borderWidth: 1, borderColor: '#E8E2D3' }, modalTitle: { color: '#24412A', fontSize: 20, fontWeight: '900', lineHeight: 26 }, modalText: { color: '#717C6D', fontSize: 13, lineHeight: 19 }, modalInput: { minHeight: 50, backgroundColor: '#F7FAF2', borderRadius: 16, paddingHorizontal: 14, color: '#24412A', borderWidth: 1, borderColor: '#E2EBDC' }, modalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  detailModalCard: { width: '92%', maxHeight: '88%', alignSelf: 'center', backgroundColor: '#FFFDF8', borderRadius: 26, padding: 16, gap: 12 }, detailTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, detailKicker: { color: '#6B7C68', fontSize: 13, fontWeight: '900' }, detailCloseButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF4EA' }, detailCloseButtonText: { color: '#315F3D', fontSize: 19, fontWeight: '900' }, detailPlantStageCard: { borderRadius: 22, backgroundColor: '#F8FBF4', borderWidth: 1, borderColor: '#E2EBDC', paddingVertical: 10, paddingHorizontal: 10 }, detailHeroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, detailHeroCenter: { alignItems: 'center' }, goalOrderSideColumn: { gap: 8 }, goalOrderInlineRow: { flexDirection: 'row', gap: 8 }, goalOrderButton: { flex: 1, minHeight: 48, borderRadius: 14, paddingVertical: 6, backgroundColor: '#EEF4EA', alignItems: 'center', justifyContent: 'center' }, goalOrderButtonDisabled: { opacity: 0.28 }, goalOrderButtonIcon: { color: '#315F3D', fontSize: 15, fontWeight: '900', textAlign: 'center', lineHeight: 17 }, goalOrderButtonLabel: { color: '#315F3D', fontSize: 11, fontWeight: '900', marginTop: 2 }, detailGoalName: { color: '#24412A', fontSize: 21, fontWeight: '900', textAlign: 'center', marginTop: 4, lineHeight: 27 }, detailGoalStage: { color: '#6B7C68', fontSize: 13, fontWeight: '900', marginTop: 2 }, detailProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, detailGoalMeta: { color: '#315F3D', fontSize: 14, fontWeight: '900', textAlign: 'center' }, detailProgressTrack: { height: 10, backgroundColor: '#E2EBDC', borderRadius: 999, overflow: 'hidden' }, detailProgressFill: { height: '100%', backgroundColor: '#74AD68' }, detailModalActions: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' }, detailActionButton: { flex: 1 }, archiveButton: { borderRadius: 16, paddingVertical: 12, alignItems: 'center', backgroundColor: '#F4EFD6' }, archiveButtonText: { color: '#7A642D', fontWeight: '900' }, detailWaterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 18, backgroundColor: '#F8FBF5', padding: 14, borderWidth: 1, borderColor: '#E6EDE0' }, detailWaterLabel: { color: '#6B7C68', fontWeight: '900' }, detailWaterCount: { color: '#315F3D', fontSize: 22, fontWeight: '900' }, detailHint: { color: '#6B7C68', fontSize: 12, textAlign: 'center', lineHeight: 18 }, waterDropOverlay: { position: 'absolute', top: 16, fontSize: 24 },
  aiModalCard: { maxHeight: '92%', backgroundColor: '#FFFDF7', borderRadius: 26 }, aiModalContent: { padding: 18, gap: 12 }, aiHeaderRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, aiHeaderTextWrap: { flex: 1 }, aiStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, aiStatusText: { color: '#6B7C68', fontSize: 13, fontWeight: '800' }, chatLog: { gap: 8 }, chatBubble: { maxWidth: '88%', borderRadius: 18, padding: 12 }, chatBubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#EEF4EA' }, chatBubbleUser: { alignSelf: 'flex-end', backgroundColor: '#315F3D' }, chatText: { color: '#24412A', fontSize: 13, lineHeight: 19 }, chatTextUser: { color: '#FFFFFF' }, aiPromptInput: { minHeight: 86, paddingTop: 12, textAlignVertical: 'top' }, aiErrorText: { color: '#B34B43', fontSize: 13, lineHeight: 18 }, draftCard: { borderRadius: 22, backgroundColor: '#FFFFFF', padding: 14, gap: 10, borderWidth: 1, borderColor: '#E4DFC9' }, draftTaskItem: { borderRadius: 18, backgroundColor: '#F8FBF5', padding: 12, gap: 8 }, draftTaskInput: { minHeight: 44, borderRadius: 14, backgroundColor: '#FFFFFF', color: '#24412A', paddingHorizontal: 12 }, inlineDangerButton: { alignSelf: 'flex-start' }, inlineDangerText: { color: '#B34B43', fontSize: 12, fontWeight: '800' },
});
