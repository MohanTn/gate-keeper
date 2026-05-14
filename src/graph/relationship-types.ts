/**
 * Semantic relationship types for the enriched knowledge graph.
 *
 * Every edge in the graph carries a RelationshipType and ConfidenceLevel so
 * agents can filter, weight, and reason about connections without reading files.
 */

export type RelationshipType =
  | 'IMPORT'
  | 'FUNCTION_CALL'
  | 'CLASS_EXTENDS'
  | 'IMPLEMENTS'
  | 'SHARED_DEPENDENCY'
  | 'CONFIG_REFERENCE'
  | 'TEST_COVERS'
  | 'COMMENTS_ABOUT'
  | 'SIMILAR_TOPIC';

export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export const RELATIONSHIP_WEIGHTS: Record<RelationshipType, number> = {
  CLASS_EXTENDS:    3,
  IMPLEMENTS:       3,
  FUNCTION_CALL:    2,
  TEST_COVERS:      2,
  IMPORT:           1,
  CONFIG_REFERENCE: 1,
  SHARED_DEPENDENCY: 0.5,
  COMMENTS_ABOUT:   0.5,
  SIMILAR_TOPIC:    0.25,
};

export interface EnrichedEdge {
  source: string;
  target: string;
  type: RelationshipType;
  confidence: ConfidenceLevel;
  weight: number;
  rationale?: string;
}

export interface WhyNode {
  id: string;
  text: string;
  file: string;
  line: number;
}
