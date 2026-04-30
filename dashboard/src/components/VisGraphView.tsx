import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data/standalone';
import { GraphData, GraphNode } from '../types';

interface VisGraphViewProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode) => void;
  highlightNodeId?: string;
  selectedRepo: string | null;
}

function ratingColor(rating: number): string {
  if (rating >= 8) return '#22c55e';
  if (rating >= 6) return '#eab308';
  if (rating >= 4) return '#f97316';
  return '#ef4444';
}

function langShape(type: string): string {
  switch (type) {
    case 'csharp': return 'square';
    case 'tsx':
    case 'jsx': return 'triangle';
    default: return 'circle';
  }
}

function layoutNodes(
  nodes: GraphNode[],
  pinnedPositions: Map<string, { x: number; y: number }>,
  graphData: GraphData
): Array<{ id: string; label: string; x: number; y: number; [key: string]: any }> {
  if (nodes.length === 0) return [];

  // Get stored positions or compute from centroid + physics simulation
  const hasStoredPositions = pinnedPositions.size > 0;
  
  if (hasStoredPositions) {
    // Use stored positions but keep them draggable
    return nodes.map(node => {
      const pos = pinnedPositions.get(node.id);
      return {
        id: node.id,
        label: node.label,
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        title: `${node.label}\nRating: ${node.rating}/10\nLOC: ${node.metrics?.linesOfCode ?? 0}\nViolations: ${(node.violations ?? []).length}`,
        color: ratingColor(node.rating),
        shape: langShape(node.type),
        size: Math.max(20, (node.size ?? 1) * 30),
        fixed: false,
        physics: false,
        mass: 1
      };
    });
  }

  // Compute initial layout with proper 2D distribution
  const nodeCount = nodes.length;
  
  // Calculate spacing based on node count and canvas size
  const baseSpacing = Math.max(200, Math.sqrt(nodeCount) * 150);
  
  return nodes.map((node, idx) => {
    let x, y;
    
    if (nodeCount === 1) {
      // Single node at center
      x = 0;
      y = 0;
    } else if (nodeCount <= 6) {
      // Circular layout for small graphs
      const angle = (idx / nodeCount) * 2 * Math.PI;
      const radius = baseSpacing * 1.5;
      x = radius * Math.cos(angle);
      y = radius * Math.sin(angle);
    } else if (nodeCount <= 25) {
      // Spiral layout for medium graphs - creates natural 2D distribution
      const spiralTightness = 0.8;
      const angle = idx * spiralTightness;
      const radius = baseSpacing * Math.sqrt(idx + 1) * 0.5;
      x = radius * Math.cos(angle);
      y = radius * Math.sin(angle);
    } else {
      // Force-directed random initial positions for large graphs
      // Use golden ratio for better distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // Golden angle in radians
      const angle = idx * goldenAngle;
      const radius = baseSpacing * Math.sqrt(idx + 1) * 0.3;
      
      // Add some randomness to break symmetry
      const randomOffset = (Math.sin(idx * 7.3) + Math.cos(idx * 11.7)) * baseSpacing * 0.2;
      
      x = radius * Math.cos(angle) + randomOffset;
      y = radius * Math.sin(angle) + randomOffset * 0.7; // Slightly less Y variation
    }

    return {
      id: node.id,
      label: node.label,
      x: x,
      y: y,
      title: `${node.label}\nRating: ${node.rating}/10\nLOC: ${node.metrics?.linesOfCode ?? 0}\nViolations: ${(node.violations ?? []).length}`,
      color: ratingColor(node.rating),
      shape: langShape(node.type),
      size: Math.max(20, (node.size ?? 1) * 30),
      physics: true,
      mass: Math.max(3, (node.size ?? 1) * 5), // Higher mass for better repulsion
      fixed: false
    };
  });
}

function layoutEdges(graphData: GraphData): Array<{ from: string; to: string; [key: string]: any }> {
  return graphData.edges.map(edge => {
    const from = typeof edge.source === 'string' ? edge.source : edge.source?.id;
    const to = typeof edge.target === 'string' ? edge.target : edge.target?.id;
    return {
      from: from as string,
      to: to as string,
      color:
        edge.type === 'import'
          ? { color: 'rgba(59,130,246,0.6)', highlight: 'rgba(59,130,246,1)' } // Import: blue
          : { color: 'rgba(249,115,22,0.6)', highlight: 'rgba(249,115,22,1)' }, // Circular: orange
      width: Math.max(1.5, (edge.strength ?? 1) * 2.5),
      arrows: {
        to: {
          enabled: true,
          scaleFactor: 0.5,
          type: 'arrow'
        }
      },
      smooth: { 
        type: 'continuous',
        forceDirection: 'none'
      },
      physics: true,
      font: {
        size: 10,
        color: '#64748b',
        strokeWidth: 0
      },
      hoverWidth: 2
    };
  });
}

export function VisGraphView({
  graphData,
  onNodeClick,
  highlightNodeId,
  selectedRepo
}: VisGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | undefined>(undefined);
  const nodesDataSetRef = useRef<DataSet<any>>(new DataSet());
  const edgesDataSetRef = useRef<DataSet<any>>(new DataSet());
  const pinnedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const shiftRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Load stored positions on mount and when repo changes
  useEffect(() => {
    if (!selectedRepo) {
      pinnedRef.current.clear();
      return;
    }

    fetch(`/api/positions?repo=${encodeURIComponent(selectedRepo)}`)
      .then(r => r.json())
      .then((data: Array<{ nodeId: string; x: number; y: number }>) => {
        pinnedRef.current = new Map(data.map(p => [p.nodeId, { x: p.x, y: p.y }]));
        // Refresh the network view
        if (networkRef.current) {
          networkRef.current.setData({
            nodes: nodesDataSetRef.current,
            edges: edgesDataSetRef.current
          });
        }
      })
      .catch(() => {});
  }, [selectedRepo]);

  // Track shift key for multi-select
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { shiftRef.current = e.shiftKey; };
    const onKeyUp = (e: KeyboardEvent) => { shiftRef.current = e.shiftKey; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Update nodes data when graphData changes - only update changed/new nodes, preserve dragged positions
  useEffect(() => {
    const visNodes = layoutNodes(graphData.nodes, pinnedRef.current, graphData);
    const currentIds = new Set(nodesDataSetRef.current.getIds());
    const newIds = new Set(visNodes.map(n => n.id));

    // Remove deleted nodes
    for (const id of currentIds) {
      if (!newIds.has(id as string)) {
        nodesDataSetRef.current.remove(id);
        pinnedRef.current.delete(id as string);
      }
    }

    // Update or add nodes - preserve positions for moved nodes
    const updates: any[] = [];
    const toAdd: any[] = [];
    
    for (const visNode of visNodes) {
      const existing = nodesDataSetRef.current.get(visNode.id);
      if (existing) {
        // Preserve the node's current position if it was dragged
        updates.push({
          ...visNode,
          x: existing.x,
          y: existing.y,
          physics: false // Keep physics disabled once positioned
        });
      } else {
        toAdd.push(visNode);
      }
    }

    if (updates.length > 0) {
      nodesDataSetRef.current.update(updates);
    }
    if (toAdd.length > 0) {
      nodesDataSetRef.current.add(toAdd);
    }
  }, [graphData.nodes]);

  // Update edges data when graphData changes - only update changed edges
  useEffect(() => {
    const visEdges = layoutEdges(graphData);
    const currentIds = new Set(edgesDataSetRef.current.getIds());
    const newIds = new Set(visEdges.map((e, i) => i.toString()));

    // Clear and rebuild edges (edges are less stable to preserve incrementally)
    edgesDataSetRef.current.clear();
    edgesDataSetRef.current.add(visEdges);
  }, [graphData.edges]);

  // Initialize network once
  useEffect(() => {
    if (!containerRef.current || networkRef.current) return;

    const options = {
      physics: {
        enabled: true,
        solver: 'barnesHut',
        barnesHut: {
          gravitationalConstant: -80000, // Strong repulsion to prevent overlap
          centralGravity: 0.1, // Small center pull to keep graph together
          springLength: 300, // Desired edge length
          springConstant: 0.04, // Edge spring strength
          damping: 0.09, // Damping for stability
          avoidOverlap: 1 // Maximum overlap avoidance
        },
        stabilization: {
          iterations: 500,
          updateInterval: 50,
          onlyDynamicEdges: false,
          fit: true
        },
        timestep: 0.5,
        adaptiveTimestep: true,
        maxVelocity: 30,
        minVelocity: 0.75
      },
      interaction: {
        hover: true,
        navigationButtons: true,
        zoomView: true,
        dragView: true,
        multiselect: true,
        keyboard: {
          enabled: true,
          speed: { x: 10, y: 10, zoom: 0.02 }
        }
      },
      nodes: {
        font: {
          size: 14,
          face: 'ui-monospace, "SF Mono", monospace',
          color: '#cbd5e1'
        },
        borderWidth: 2,
        borderWidthSelected: 3,
        margin: {
          top: 15,
          right: 15,
          bottom: 15,
          left: 15
        },
        widthConstraint: {
          maximum: 120
        },
        shapeProperties: {
          interpolation: true
        },
        scaling: {
          min: 20,
          max: 80,
          label: { enabled: true, min: 12, max: 18 }
        }
      },
      edges: {
        smooth: {
          enabled: true,
          type: 'continuous' as const,
          forceDirection: 'none',
          roundness: 0.5
        },
        font: {
          size: 10,
          color: '#64748b',
          face: 'ui-monospace, "SF Mono", monospace'
        },
        hoverWidth: 2,
        selectionWidth: 3
      },
      groups: {
        useDefaultGroups: false
      }
    };

    const network = new Network(
      containerRef.current,
      {
        nodes: nodesDataSetRef.current,
        edges: edgesDataSetRef.current
      },
      options
    );

    networkRef.current = network;

    // Handle node clicks
    network.on('click', (params: any) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0] as string;
        const node = nodesDataSetRef.current.get(nodeId) as any;

        if (shiftRef.current) {
          setSelectedNodes(prev => {
            const next = new Set(prev);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
          });
        } else {
          setSelectedNodes(new Set([nodeId]));
          // Find the original GraphNode and pass it to callback
          const graphNode = graphData.nodes.find(n => n.id === nodeId);
          if (graphNode) {
            onNodeClick(graphNode);
          }
        }

        // Highlight selected nodes
        const highlightedNodes = new Set(selectedNodes);
        if (shiftRef.current) {
          if (highlightedNodes.has(nodeId)) {
            highlightedNodes.delete(nodeId);
          } else {
            highlightedNodes.add(nodeId);
          }
        } else {
          highlightedNodes.clear();
          highlightedNodes.add(nodeId);
        }

        // Update node colors based on selection
        const updates = Array.from(nodesDataSetRef.current.getIds()).map(id => {
          const nodeIdStr = id as string;
          const node = nodesDataSetRef.current.get(nodeIdStr) as any;
          const graphNode = graphData.nodes.find(n => n.id === nodeIdStr);
          return {
            ...node,
            color: highlightedNodes.has(nodeIdStr) ? { background: '#fff', border: '#3b82f6' } : ratingColor(graphNode?.rating ?? 0),
            borderWidth: highlightedNodes.has(nodeIdStr) ? 3 : 2
          };
        });
        nodesDataSetRef.current.update(updates);
      } else {
        setSelectedNodes(new Set());
        // Clear selection highlight
        const updates = Array.from(nodesDataSetRef.current.getIds()).map(id => {
          const nodeIdStr = id as string;
          const node = nodesDataSetRef.current.get(nodeIdStr) as any;
          const graphNode = graphData.nodes.find(n => n.id === nodeIdStr);
          return {
            ...node,
            color: ratingColor(graphNode?.rating ?? 0),
            borderWidth: 2
          };
        });
        nodesDataSetRef.current.update(updates);
      }
    });

    // Handle drag end to save positions and ensure they stay in place
    network.on('dragEnd', (params: any) => {
      if (params.nodes.length > 0) {
        const draggedNodeIds = params.nodes; // Can be multiple with multi-select
        
        // Collect all nodes to update (dragged + multi-selected)
        const nodesToUpdate = new Set(draggedNodeIds);
        if (selectedNodes.size > 0) {
          selectedNodes.forEach(id => nodesToUpdate.add(id));
        }

        // Save positions for all dragged/selected nodes
        const positionsToSave: Array<{ nodeId: string; x: number; y: number }> = [];
        const updates: any[] = [];
        
        for (const nodeId of nodesToUpdate) {
          const node = nodesDataSetRef.current.get(nodeId as string) as any;
          if (node) {
            const pos = { x: node.x, y: node.y };
            pinnedRef.current.set(nodeId as string, pos);
            positionsToSave.push({ nodeId: nodeId as string, ...pos });
            
            // Update node to ensure physics is disabled and position is locked
            updates.push({
              ...node,
              x: node.x,
              y: node.y,
              fixed: false, // Keep draggable for next interaction
              physics: false // Prevent any physics movement
            });
          }
        }

        if (updates.length > 0) {
          nodesDataSetRef.current.update(updates);
        }

        // Persist all positions to server
        if (selectedRepo && positionsToSave.length > 0) {
          Promise.all(
            positionsToSave.map(({ nodeId, x, y }) =>
              fetch('/api/positions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  repo: selectedRepo,
                  nodeId,
                  x,
                  y
                })
              }).catch(() => {})
            )
          );
        }
      }
    });

    // Fit to view after stabilization completes (not before)
    let fitTimer: NodeJS.Timeout;
    
    const fitToView = () => {
      if (networkRef.current) {
        try {
          networkRef.current.fit({ 
            animation: { duration: 500, easingFunction: 'easeInOutQuad' },
            maxZoomLevel: 1 // Don't zoom in too much
          });
        } catch (e) {}
      }
    };

    // Initial fit after a delay to let physics settle
    fitTimer = setTimeout(fitToView, 100);

    // Disable physics after stabilization but keep nodes draggable
    network.once('stabilizationIterationsDone', () => {
      // Disable physics to maintain stable layout
      network.setOptions({ physics: false });
      
      // Save final positions and lock them to prevent any further automatic movement
      const nodes = nodesDataSetRef.current.getIds() as string[];
      const updates = nodes.map(id => {
        const node = nodesDataSetRef.current.get(id) as any;
        const pos = { x: node.x, y: node.y };
        pinnedRef.current.set(id, pos);
        
        return {
          ...node,
          x: pos.x,
          y: pos.y,
          fixed: false, // Allow dragging
          physics: false // No physics movement
        };
      });
      nodesDataSetRef.current.update(updates);
      
      // Fit to view after stabilization to show final layout
      setTimeout(() => fitToView(), 100);
    });

    return () => {
      if (fitTimer) clearTimeout(fitTimer);
      network.destroy();
      networkRef.current = undefined;
    };
  }, []);

  return (
    <div style={{ flex: 1, position: 'relative', background: '#0a0f1e', overflow: 'hidden' }}>
      {graphData.nodes.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#1e293b',
            pointerEvents: 'none',
            zIndex: 1
          }}
        >
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <path
              d="M32 4L58 18V46L32 60L6 46V18L32 4Z"
              stroke="#1e293b"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M32 20L44 27V41L32 48L20 41V27L32 20Z"
              stroke="#263347"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
          <div style={{ fontSize: 16, color: '#334155', fontWeight: 600 }}>No files analyzed</div>
          <div style={{ fontSize: 13, color: '#1e293b' }}>Click "Scan All Files" to analyze your workspace</div>
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          background: 'rgba(17,24,39,0.9)',
          border: '1px solid #1e293b',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12,
          color: '#64748b',
          backdropFilter: 'blur(4px)',
          zIndex: 10
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            color: '#94a3b8',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.8
          }}
        >
          Legend
        </div>
        <div style={{ marginBottom: 3 }}>● TypeScript / JS</div>
        <div style={{ marginBottom: 3 }}>■ C#</div>
        <div style={{ marginBottom: 8 }}>▲ React (TSX / JSX)</div>
        <div style={{ display: 'flex', gap: 10, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
          <span style={{ color: '#22c55e' }}>■</span>
          <span>≥ 8</span>
          <span style={{ color: '#eab308' }}>■</span>
          <span>≥ 6</span>
          <span style={{ color: '#f97316' }}>■</span>
          <span>≥ 4</span>
          <span style={{ color: '#ef4444' }}>■</span>
          <span>&lt; 4</span>
        </div>
      </div>

      {/* Interaction hints */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          fontSize: 11,
          color: '#1e293b',
          pointerEvents: 'none',
          textAlign: 'right',
          lineHeight: 1.8,
          zIndex: 10
        }}
      >
        <div>Drag to pan • Scroll to zoom</div>
        <div>Click node to inspect • Shift+click to multi-select</div>
      </div>
    </div>
  );
}
