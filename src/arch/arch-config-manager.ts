import * as fs from 'fs';
import * as path from 'path';
import { ArchConnection, ArchLayerDef, ArchMapping } from '../types';

export const ARCH_CONFIG_VERSION = '1.1';

export const DEFAULT_LAYERS: ArchLayerDef[] = [
  { id: 'application', label: 'Application Layer', color: 'rgba(219,39,119,0.08)', order: 0 },
  { id: 'interface', label: 'Interface Layer', color: 'rgba(234,179,8,0.08)', order: 1 },
  { id: 'usecase', label: 'Use Case Layer', color: 'rgba(59,130,246,0.08)', order: 2 },
  { id: 'domain', label: 'Domain Layer', color: 'rgba(34,197,94,0.08)', order: 3 },
  { id: 'entity', label: 'Entity Layer', color: 'rgba(16,185,129,0.08)', order: 4 },
  { id: 'data', label: 'Data Layer', color: 'rgba(245,158,11,0.08)', order: 5 },
  { id: 'infrastructure', label: 'Infrastructure Layer', color: 'rgba(239,68,68,0.08)', order: 6 },
];

// Derive linear allowed-transition pairs from layer order: every (i, j) with j > i.
// This preserves v1.0 semantics — outer layer can depend on any more-inner layer.
export function deriveConnectionsFromOrder(layers: ArchLayerDef[]): ArchConnection[] {
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const out: ArchConnection[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      out.push({ from: sorted[i].id, to: sorted[j].id });
    }
  }
  return out;
}

export const DEFAULT_ARCH_CONFIG: ArchMapping = {
  version: ARCH_CONFIG_VERSION,
  layers: DEFAULT_LAYERS,
  connections: deriveConnectionsFromOrder(DEFAULT_LAYERS),
  files: {},
  overrides: {},
};

const LAYER_PATTERNS: Record<string, { folderPatterns: string[]; filePatterns: RegExp[] }> = {
  application: {
    folderPatterns: ['app', 'application', 'main', 'startup', 'program', 'main.tsx'],
    filePatterns: [/\.app\.tsx?$/, /^main\.tsx?$/, /^app\.tsx?$/, /^index\.tsx?$/],
  },
  interface: {
    folderPatterns: ['api', 'controllers', 'routes', 'handlers', 'mcp', 'hook-receiver', 'components', 'icons'],
    filePatterns: [/\.controller\.ts$/, /\.route\.ts$/, /\.handler\.ts$/, /\.endpoint\.ts$/, /\.component\.tsx?$/, /\.modal\.tsx?$/, /\.panel\.tsx?$/],
  },
  usecase: {
    folderPatterns: ['usecases', 'use-cases', 'services', 'daemon', 'viz', 'hooks', 'utils'],
    filePatterns: [/\.service\.ts$/, /\.usecase\.ts$/, /\.use-case\.ts$/, /^use[A-Z].*\.tsx?$/, /\.tsx?$/],
  },
  domain: {
    folderPatterns: ['domain', 'types', 'models', 'rating', 'context'],
    filePatterns: [/\.domain\.ts$/, /\.model\.ts$/, /types\.ts$/, /^types\.tsx?$/, /\.context\.tsx?$/, /\.interface\.ts$/],
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
    folderPatterns: ['infrastructure', 'config', 'setup', 'scripts', 'vite'],
    filePatterns: [/\.config\.ts$/, /\.setup\.ts$/, /\.infrastructure\.ts$/, /\.conf\.ts$/, /^vite\.config\.ts$/, /jest\.config\.js$/],
  },
};

export function getArchFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.gate-keeper', 'arch.json');
}

// Drop connections referencing unknown layer ids; warn but never throw.
function sanitizeConnections(
  connections: ArchConnection[] | undefined,
  layers: ArchLayerDef[],
): ArchConnection[] | undefined {
  if (!connections) return undefined;
  const knownIds = new Set(layers.map(l => l.id));
  const valid: ArchConnection[] = [];
  for (const c of connections) {
    if (knownIds.has(c.from) && knownIds.has(c.to)) {
      valid.push(c);
    } else {
      console.warn(`arch.json: dropping connection ${c.from}→${c.to} (unknown layer id)`);
    }
  }
  return valid;
}

export function readArchConfig(repoRoot: string): ArchMapping {
  try {
    const filePath = getArchFilePath(repoRoot);
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_ARCH_CONFIG };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as ArchMapping;
    const layers = parsed.layers ?? DEFAULT_LAYERS;
    const connections = sanitizeConnections(parsed.connections, layers)
      ?? deriveConnectionsFromOrder(layers);
    return { ...DEFAULT_ARCH_CONFIG, ...parsed, layers, connections };
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
    // Preserve key order: version, layers, connections, files, overrides
    const ordered: ArchMapping = {
      version: ARCH_CONFIG_VERSION,
      layers: config.layers,
      connections: config.connections ?? deriveConnectionsFromOrder(config.layers),
      files: config.files,
      overrides: config.overrides,
    };
    fs.writeFileSync(filePath, JSON.stringify(ordered, null, 2), 'utf-8');
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
