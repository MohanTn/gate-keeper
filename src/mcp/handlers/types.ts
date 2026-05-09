import { FileAnalysis } from '../../types';

export interface GraphNodeData {
  id: string;
  label: string;
  type: string;
  rating: number;
  size: number;
  violations: Array<{ type: string; severity: string; message: string; line?: number; fix?: string }>;
  metrics: {
    linesOfCode: number;
    cyclomaticComplexity: number;
    numberOfMethods: number;
    numberOfClasses: number;
    importCount: number;
    coveragePercent?: number;
  };
}

export interface GraphEdgeData {
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface GraphResponse {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

export interface FileDetailResponse {
  analysis?: FileAnalysis;
  ratingBreakdown?: Array<{ category: string; deduction: number; detail: string }>;
  gitDiff?: { added: number; removed: number } | null;
}
