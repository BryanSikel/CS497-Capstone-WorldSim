export type Difficulty = "Medium" | "Hard" | "Very Hard";

export interface ContinentConfig {
  name: string;
  difficulty: Difficulty;
  timeLimitSeconds: number;
  dropToleranceRadius: number;
  hintsAllowed: number;
}

export const CONTINENT_CONFIGS: Record<string, ContinentConfig> = {
  "South America": {
    name: "South America",
    difficulty: "Medium",
    timeLimitSeconds: 20,
    dropToleranceRadius: 40,
    hintsAllowed: 2,
  },
  "Asia": {
    name: "Asia",
    difficulty: "Medium",
    timeLimitSeconds: 20,
    dropToleranceRadius: 40,
    hintsAllowed: 2,
  },
  "North America": {
    name: "North America",
    difficulty: "Hard",
    timeLimitSeconds: 15,
    dropToleranceRadius: 30,
    hintsAllowed: 1,
  },
  "Europe": {
    name: "Europe",
    difficulty: "Hard",
    timeLimitSeconds: 15,
    dropToleranceRadius: 30,
    hintsAllowed: 1,
  },
  "Africa": {
    name: "Africa",
    difficulty: "Very Hard",
    timeLimitSeconds: 12,
    dropToleranceRadius: 22,
    hintsAllowed: 0,
  },
};

export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  "Medium": "#f0ad4e",
  "Hard": "#d9534f",
  "Very Hard": "#8b0000",
};