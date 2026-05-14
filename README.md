# Sprout

<p align="center">
  <img src="./封面.png" alt="Sprout cover" width="180" />
</p>

<p align="center">
  A gentle, visually cozy Expo app that turns daily tasks, mood check-ins, and personal goals into a growing plant habitat.
</p>

<p align="center">
  <img alt="Expo" src="https://img.shields.io/badge/Expo-54-1B1F23?style=flat-square&logo=expo&logoColor=white" />
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.81-20232A?style=flat-square&logo=react&logoColor=61DAFB" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" />
</p>

## Overview

Sprout is a small mobile app for gentle self-growth.
It transforms goals into plants, completed tasks into water drops, and daily mood check-ins into a calm reflection ritual.

Instead of treating productivity as pressure, Sprout visualizes progress as something soft, slow, and alive.

## Features

- **Plant-based goal visualization** — turn long-term goals into growing plants with visible progress stages
- **Task-to-reward loop** — complete daily tasks to earn water drops and invest them into goal growth
- **Mood check-ins** — log how you feel today with a short note and lightweight emotional feedback
- **Daily and weekly habits** — support both one-time tasks and recurring routines
- **Reflection timeline** — review moods, completed tasks, and watering records by day
- **Offline-friendly local storage** — app state is saved locally on device using Expo file storage

## Experience

Sprout is designed around a calm emotional tone:

- soft plant-inspired visuals
- low-pressure progress tracking
- small actions instead of overwhelming plans
- a reflective, cozy mobile-first interface

## Built With

- [Expo](https://expo.dev/)
- [React Native](https://reactnative.dev/)
- [TypeScript](https://www.typescriptlang.org/)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/azhan12138/sprout-app-clean.git
cd sprout-app-clean
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run start
```

If you are using PowerShell and `npm` is blocked by execution policy, use:

```powershell
npm.cmd run start
```

### 4. Open on your phone

- Install **Expo Go** on your phone
- Connect your phone and computer to the same Wi-Fi
- Run the app with `npm run start`
- Scan the QR code with Expo Go

## Scripts

```bash
npm run start
npm run android
npm run ios
npm run web
```

## Project Structure

```text
.
├─ App.tsx
├─ index.ts
├─ app.json
├─ src/
│  ├─ data/
│  ├─ storage/
│  ├─ utils/
│  └─ types.ts
└─ assets/
```

## Current Functionality

The current version includes:

- habitat view for goals and plant progress
- task view for mood logging and reward collection
- review view for daily summaries
- goal archiving, reordering, editing, and watering
- task editing and recurring schedule support
- keyboard avoidance and tap-blank-to-dismiss behavior on mobile input flows

## Roadmap

Possible future improvements:

- richer plant illustrations and stage transitions
- onboarding for first-time users
- export/shareable growth snapshots
- cloud sync or account-based backup
- stronger accessibility and larger-text support

## Why This Project

Sprout explores a softer way to think about self-management.
It is not just a task tracker — it is an attempt to make progress feel visible, kind, and emotionally sustainable.

## License

This repository does not include a license yet.
If you want others to freely reuse it, adding an MIT License is recommended.
