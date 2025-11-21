export interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  color?: string;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
  COMPLETE = 'COMPLETE',
}

export interface DimensionState {
  score: number;           // Current estimate (0-5)
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  evidenceCount: number;
  trend: 'up' | 'down' | 'stable';
  contextNotes?: string;
}

export interface EvidenceItem {
  timestamp: string;
  dimension: string;
  type: 'positive' | 'negative' | 'contextual';
  summary: string;
  scoreImpact?: number;
}

export interface ContradictionAlert {
  dimension: string;
  earlyStatement: string;
  lateStatement: string;
  resolution: string;
}

export interface ScorePoint {
  time: number; // seconds from start
  DT: number;
  TR: number;
  CO: number;
  CA: number;
  EP: number;
}

export interface SessionState {
  dimensions: {
    DT: DimensionState; // Directness & Transparency
    TR: DimensionState; // Task vs Relational
    CO: DimensionState; // Conflict Orientation
    CA: DimensionState; // Cultural Adaptability
    EP: DimensionState; // Empathy & Perspective
  };
  scoreHistory: ScorePoint[];
  evidenceLog: EvidenceItem[];
  contradictions: ContradictionAlert[];
  conversationPhase: 'OPENING' | 'CORE' | 'GAP_FILLING' | 'VALIDATION' | 'CLOSING';
  strengths: string[];
  developmentPriorities: string[];
  summary?: string;
  fullReport?: string;
}

export const INITIAL_SESSION_STATE: SessionState = {
  dimensions: {
    DT: { score: 3.0, confidence: 'LOW', evidenceCount: 0, trend: 'stable' },
    TR: { score: 3.0, confidence: 'LOW', evidenceCount: 0, trend: 'stable' },
    CO: { score: 3.0, confidence: 'LOW', evidenceCount: 0, trend: 'stable' },
    CA: { score: 3.0, confidence: 'LOW', evidenceCount: 0, trend: 'stable' },
    EP: { score: 3.0, confidence: 'LOW', evidenceCount: 0, trend: 'stable' },
  },
  scoreHistory: [{ time: 0, DT: 3, TR: 3, CO: 3, CA: 3, EP: 3 }],
  evidenceLog: [],
  contradictions: [],
  conversationPhase: 'OPENING',
  strengths: [],
  developmentPriorities: [],
};

export const DIMENSION_LABELS: Record<string, string> = {
  DT: "Directness & Transparency",
  TR: "Task vs Relational",
  CO: "Conflict Orientation",
  CA: "Cultural Adaptability",
  EP: "Empathy & Perspective"
};