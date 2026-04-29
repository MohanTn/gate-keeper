Universal Analyzer Implementation
1. Language Detection & Routing
typescript
// universal-analyzer.ts
interface FileAnalysis {
    path: string;
    language: 'csharp' | 'typescript' | 'tsx' | 'jsx';
    ast: any;
    dependencies: Dependency[];
    metrics: Metrics;
    rating: number;
}

class UniversalAnalyzer {
    async analyze(filePath: string): Promise<FileAnalysis> {
        const extension = path.extname(filePath);
        
        const handlers = {
            '.cs': () => this.analyzeCSharp(filePath),
            '.ts': () => this.analyzeTypeScript(filePath),
            '.tsx': () => this.analyzeReact(filePath),
            '.jsx': () => this.analyzeReact(filePath)
        };
        
        const handler = handlers[extension];
        if (!handler) return null;
        
        const analysis = await handler();
        
        // Convert to unified format
        return this.toUnifiedFormat(analysis);
    }
    
    private async analyzeCSharp(filePath: string) {
        // Use Roslyn via Node bridge or gRPC
        const result = await execAsync('dotnet', [
            'run', '--project', './Analyzers/CSharpAnalyzer',
            '--file', filePath,
            '--output', 'json'
        ]);
        
        return JSON.parse(result);
    }
    
    private async analyzeReact(filePath: string) {
        // Use TypeScript Compiler API
        const ts = require('typescript');
        const content = fs.readFileSync(filePath, 'utf8');
        
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true
        );
        
        return this.extractReactInfo(sourceFile);
    }
}
2. ReactJS Specific Analysis
typescript
// react-analyzer.ts
class ReactAnalyzer {
    extractComponentTree(sourceFile: ts.SourceFile) {
        const components = [];
        
        function visit(node: ts.Node) {
            // Detect functional components
            if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
                const hasJSX = node.getChildren().some(child => 
                    child.getText().includes('<') && child.getText().includes('>')
                );
                
                if (hasJSX) {
                    components.push({
                        name: node.name?.getText() || 'Anonymous',
                        type: 'functional',
                        hooks: extractHooks(node),
                        props: extractProps(node),
                        children: extractChildComponents(node)
                    });
                }
            }
            
            // Detect class components
            if (ts.isClassDeclaration(node)) {
                const heritage = node.heritageClauses;
                const extendsReact = heritage?.some(h => 
                    h.getText().includes('Component') || 
                    h.getText().includes('PureComponent')
                );
                
                if (extendsReact) {
                    components.push({
                        name: node.name?.getText(),
                        type: 'class',
                        lifecycle: extractLifecycleMethods(node),
                        state: extractState(node)
                    });
                }
            }
            
            ts.forEachChild(node, visit);
        }
        
        visit(sourceFile);
        return components;
    }
    
    detectReactAntiPatterns(components: Component[]): Violation[] {
        const violations = [];
        
        // 1. Deep component nesting (>3 levels)
        const deepNesting = components.filter(c => c.depth > 3);
        deepNesting.forEach(c => {
            violations.push({
                type: 'deep_nesting',
                severity: 'warning',
                message: `Component ${c.name} is nested ${c.depth} levels deep`,
                fix: 'Extract into smaller components'
            });
        });
        
        // 2. Too many hooks (>7 per component)
        components.forEach(c => {
            if (c.hooks && c.hooks.length > 7) {
                violations.push({
                    type: 'hook_overload',
                    severity: 'warning',
                    message: `${c.name} has ${c.hooks.length} hooks`,
                    fix: 'Split into custom hooks or smaller components'
                });
            }
        });
        
        // 3. Missing memo for expensive components
        // 4. Direct state mutations
        // 5. Missing keys in lists
        // 6. Large bundles (>50kb)
        
        return violations;
    }
}
3. .NET Specific Analysis
csharp
// CSharpAnalyzer.cs
public class CSharpAnalyzer 
{
    public async Task<AnalysisResult> AnalyzeAsync(string filePath)
    {
        var syntaxTree = CSharpSyntaxTree.ParseText(
            await File.ReadAllTextAsync(filePath)
        );
        
        var compilation = CSharpCompilation.Create("Temp")
            .AddSyntaxTrees(syntaxTree)
            .AddReferences(
                MetadataReference.CreateFromFile(typeof(object).Assembly.Location),
                MetadataReference.CreateFromFile(typeof(Console).Assembly.Location)
            );
        
        var semanticModel = compilation.GetSemanticModel(syntaxTree);
        var root = await syntaxTree.GetRootAsync();
        
        var dependencies = new List<Dependency>();
        var violations = new List<Violation>();
        
        // Detect dependency cycles
        var collector = new DependencyCollector(semanticModel);
        collector.Visit(root);
        dependencies.AddRange(collector.Dependencies);
        
        // Detect anti-patterns
        violations.AddRange(DetectGodClass(root, semanticModel));
        violations.AddRange(DetectTightCoupling(root, semanticModel));
        violations.AddRange(DetectFeatureEnvy(root, semanticModel));
        
        return new AnalysisResult
        {
            FilePath = filePath,
            Dependencies = dependencies,
            Violations = violations,
            Metrics = CalculateMetrics(root),
            Rating = CalculateRating(violations, dependencies)
        };
    }
}
Local Visualization Dashboard
4. WebSocket Server for Real-time Updates
typescript
// viz-server.ts
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

class VisualizationServer {
    private app = express();
    private server = createServer(this.app);
    private wss = new WebSocketServer({ server });
    private graphData: GraphData = { nodes: [], edges: [] };
    
    constructor() {
        this.setupRoutes();
        this.setupWebSocket();
        this.start();
    }
    
    private setupRoutes() {
        // Serve React dashboard
        this.app.use('/viz', express.static('./dashboard/build'));
        
        // API endpoints
        this.app.get('/api/graph', (req, res) => {
            res.json(this.graphData);
        });
        
        this.app.get('/api/hotspots', (req, res) => {
            res.json(this.findArchitecturalHotspots());
        });
        
        this.app.get('/api/trends', (req, res) => {
            res.json(this.getRatingHistory());
        });
    }
    
    private setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('Dashboard connected');
            
            // Send real-time updates
            ws.send(JSON.stringify({
                type: 'init',
                data: this.graphData
            }));
        });
    }
    
    updateGraph(analysis: FileAnalysis) {
        // Update force-directed graph
        this.graphData.nodes.push({
            id: analysis.path,
            label: path.basename(analysis.path),
            type: analysis.language,
            rating: analysis.rating,
            size: analysis.metrics.linesOfCode / 100
        });
        
        analysis.dependencies.forEach(dep => {
            this.graphData.edges.push({
                from: analysis.path,
                to: dep.target,
                type: dep.type,
                strength: dep.weight
            });
        });
        
        // Broadcast to connected dashboards
        this.broadcast({
            type: 'update',
            delta: { nodes: [analysis.path], edges: analysis.dependencies }
        });
    }
    
    start() {
        const port = 5378;
        this.server.listen(port, () => {
            console.log(`📊 Architecture Viz: http://localhost:${port}`);
        });
    }
}
5. React Dashboard Component
tsx
// dashboard/src/App.tsx
import React, { useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface Node {
    id: string;
    label: string;
    type: 'csharp' | 'typescript';
    rating: number;
    violations: Violation[];
}

function ArchitectureDashboard() {
    const [graphData, setGraphData] = useState({ nodes: [], links: [] });
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [ws, setWs] = useState<WebSocket | null>(null);
    
    useEffect(() => {
        // Connect to local WebSocket
        const socket = new WebSocket('ws://localhost:5378');
        socket.onmessage = (event) => {
            const update = JSON.parse(event.data);
            if (update.type === 'update') {
                setGraphData(prev => ({
                    nodes: [...prev.nodes, update.delta.nodes],
                    links: [...prev.links, ...update.delta.edges]
                }));
            }
        };
        setWs(socket);
        
        // Fetch initial data
        fetch('/api/graph').then(res => res.json()).then(setGraphData);
        
        return () => socket.close();
    }, []);
    
    const getNodeColor = (node: Node) => {
        if (node.rating >= 8) return '#4CAF50'; // Green
        if (node.rating >= 6) return '#FFC107'; // Yellow
        if (node.rating >= 4) return '#FF9800'; // Orange
        return '#F44336'; // Red
    };
    
    return (
        <div style={{ display: 'flex', height: '100vh' }}>
            {/* Graph View */}
            <div style={{ flex: 3 }}>
                <ForceGraph2D
                    graphData={graphData}
                    nodeLabel="label"
                    nodeColor={getNodeColor}
                    nodeVal={node => node.size || 1}
                    linkWidth={link => Math.sqrt(link.strength || 1)}
                    onNodeClick={(node) => setSelectedNode(node)}
                    cooldownTicks={100}
                />
            </div>
            
            {/* Sidebar - Violations & Metrics */}
            <div style={{ flex: 1, padding: 20, background: '#f5f5f5' }}>
                {selectedNode ? (
                    <>
                        <h2>{selectedNode.label}</h2>
                        <div style={{ 
                            background: getNodeColor(selectedNode),
                            padding: 10,
                            borderRadius: 5,
                            color: 'white'
                        }}>
                            Rating: {selectedNode.rating}/10
                        </div>
                        
                        <h3>Violations:</h3>
                        <ul>
                            {selectedNode.violations?.map(v => (
                                <li key={v.type} style={{ color: '#d32f2f' }}>
                                    {v.message}
                                    <button onClick={() => autoFix(v)}>
                                        🔧 Auto-fix
                                    </button>
                                </li>
                            ))}
                        </ul>
                        
                        <h3>Dependencies:</h3>
                        <ul>
                            {graphData.links
                                .filter(l => l.source === selectedNode.id)
                                .map(l => (
                                    <li key={l.target}>
                                        → {l.target} ({l.type})
                                    </li>
                                ))}
                        </ul>
                    </>
                ) : (
                    <div>
                        <h3>Architecture Health</h3>
                        <MetricCard 
                            title="Overall Rating" 
                            value={calculateOverallRating()}
                            trend="down"
                        />
                        <MetricCard 
                            title="Circular Dependencies" 
                            value={countCircularDeps()}
                            alert={true}
                        />
                        <MetricCard 
                            title="Hotspots" 
                            value={findHotspots().length}
                            onClick={() => highlightHotspots()}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
Automatic Browser Launch (Subtle)
typescript
// auto-open-dashboard.ts
import open from 'open';
import { getPortStatus } from 'port-check';

class SubtleDashboardOpener {
    private hasOpened = false;
    
    async maybeOpenDashboard() {
        // Only open if:
        // 1. User never opened it before this session
        // 2. Rating dropped below 5.0 (needs attention)
        // 3. Or user explicitly hovers status icon for 3 seconds
        
        if (this.hasOpened) return;
        
        const rating = await getCurrentRating();
        
        if (rating < 5.0) {
            // Open quietly in background tab
            await open('http://localhost:5378/viz', {
                wait: false,
                background: true  // Don't steal focus
            });
            
            // Show only a subtle notification
            showStatusMessage('📊 Architecture issues detected', {
                hideAfter: 3000,
                severity: 'low'
            });
            
            this.hasOpened = true;
        }
    }
}

// User can manually open via command palette or clicking status icon
vscode.commands.registerCommand('architecture.showDashboard', () => {
    open('http://localhost:5378/viz');
});
Installation & User Experience
bash
# One-time setup (silent)
npm install -g architecture-gate
architecture-gate init --silent

# Auto-starts on project detection
# - Analyzes both .cs and .tsx files
# - Launches viz server on port 5378
# - Opens browser ONLY if rating < 5.0

# User sees:
# - Tiny status indicator: "● Arch: 7.2"
# - Hover: "Click to open visualization"
# - Dashboard: http://localhost:5378 (manual open)
Result: Developer codes normally, background analysis happens, visualization is available on demand, and architectural issues become visible through an intuitive graph interface.