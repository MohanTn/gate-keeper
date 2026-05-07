import * as fs from 'fs';
import * as path from 'path';
import { ArchLayerDef, ArchMapping } from '../types';

export const DEFAULT_LAYERS: ArchLayerDef[] = [
  { id: 'application', label: 'Application Layer', color: 'rgba(219,39,119,0.08)', order: 0 },
  { id: 'interface', label: 'Interface Layer', color: 'rgba(234,179,8,0.08)', order: 1 },
  { id: 'usecase', label: 'Use Case Layer', color: 'rgba(59,130,246,0.08)', order: 2 },
  { id: 'domain', label: 'Domain Layer', color: 'rgba(34,197,94,0.08)', order: 3 },
  { id: 'entity', label: 'Entity Layer', color: 'rgba(16,185,129,0.08)', order: 4 },
  { id: 'data', label: 'Data Layer', color: 'rgba(245,158,11,0.08)', order: 5 },
  { id: 'infrastructure', label: 'Infrastructure Layer', color: 'rgba(239,68,68,0.08)', order: 6 },
];

export const DEFAULT_ARCH_CONFIG: ArchMapping = {
  version: '1.0',
  layers: DEFAULT_LAYERS,
  files: {},
  overrides: {},
};

const LAYER_PATTERNS: Record<string, { folderPatterns: string[]; filePatterns: RegExp[] }> = {
  application: {
    folderPatterns: ['app', 'application', 'main', 'startup', 'program'],
    filePatterns: [/\.app\.ts$/, /main\.ts$/, /^index\.ts$/],
  },
  interface: {
    folderPatterns: ['api', 'controllers', 'routes', 'handlers', 'mcp', 'hook-receiver'],
    filePatterns: [/\.controller\.ts$/, /\.route\.ts$/, /\.handler\.ts$/, /\.endpoint\.ts$/],
  },
  usecase: {
    folderPatterns: ['usecases', 'use-cases', 'services', 'daemon', 'viz'],
    filePatterns: [/\.service\.ts$/, /\.usecase\.ts$/, /\.use-case\.ts$/],
  },
  domain: {
    folderPatterns: ['domain', 'types', 'models', 'rating'],
    filePatterns: [/\.domain\.ts$/, /\.model\.ts$/, /types\.ts$/, /^types\.tsx?$/],
  },
  entity: {
    folderPatterns: ['entities', 'analyzer'],
    filePatterns: [/\.entity\.ts$/, /-analyzer\.ts$/, /\.analyzer\.ts$/],
  },
  data: {
    folderPatterns: ['cache', 'repository', 'persistence', 'database', 'graph'],
    filePatterns: [/\.repository\.ts$/, /\.cache\.ts$/, /\.db\.ts$/, /\.storage\.ts$/],
  },
  infrastructure: {
    folderPatterns: ['infrastructure', 'config', 'setup', 'scripts'],
    filePatterns: [/\.config\.ts$/, /\.setup\.ts$/, /\.infrastructure\.ts$/],
  },
};

export function getArchFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.gate-keeper', 'arch.json');
}

export function readArchConfig(repoRoot: string): ArchMapping {
  try {
    const filePath = getArchFilePath(repoRoot);
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_ARCH_CONFIG };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as ArchMapping;
    return { ...DEFAULT_ARCH_CONFIG, ...parsed };
  } catch (error) {
    console.warn(`Failed to read arch config from ${repoRoot}:`, error);
    return { ...DEFAULT_ARCH_CONFIG };
  }
}

export function writeArchConfig(repoRoot: string, config: ArchMapping): void {
  try {
    const archDir = path.join(repoRoot, '.gate-keeper');
    if (!fs.existsSync(archDir)) {
      fs.mkdirSync(archDir, { recursive: true });
    }
    const filePath = getArchFilePath(repoRoot);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to write arch config to ${repoRoot}:`, error);
  }
}

export function autoDetectLayer(filePath: string, repoRoot: string, layerDefs: ArchLayerDef[]): string {
  const relPath = path.relative(repoRoot, filePath).toLowerCase();
  const parts = relPath.split(path.sep);
  const filename = parts[parts.length - 1];

  for (const layerDef of layerDefs) {
    const patterns = LAYER_PATTERNS[layerDef.id];
    if (!patterns) continue;

    // Check folder patterns
    for (const folderPattern of patterns.folderPatterns) {
      if (parts.some(part => part === folderPattern.toLowerCase())) {
        return layerDef.id;
      }
    }

    // Check file patterns
    for (const filePattern of patterns.filePatterns) {
      if (filePattern.test(filename)) {
        return layerDef.id;
      }
    }
  }

  return 'unknown';
}

export function mergeFileLayer(
  repoRoot: string,
  relPath: string,
  detectedLayer: string,
): void {
  const config = readArchConfig(repoRoot);

  // Only update files section, never touch overrides
  if (!config.overrides[relPath]) {
    config.files[relPath] = detectedLayer;
  }

  writeArchConfig(repoRoot, config);
}

export function getEffectiveLayer(config: ArchMapping, relPath: string): string {
  return config.overrides[relPath] ?? config.files[relPath] ?? 'unknown';
}

export function setLayerOverride(repoRoot: string, relPath: string, layer: string): void {
  const config = readArchConfig(repoRoot);

  // Set override
  config.overrides[relPath] = layer;

  // Remove from files since override is now authoritative
  if (config.files[relPath]) {
    delete config.files[relPath];
  }

  writeArchConfig(repoRoot, config);
}

export function clearLayerOverride(repoRoot: string, relPath: string): void {
  const config = readArchConfig(repoRoot);

  // Remove override
  if (config.overrides[relPath]) {
    delete config.overrides[relPath];
  }

  writeArchConfig(repoRoot, config);
}
