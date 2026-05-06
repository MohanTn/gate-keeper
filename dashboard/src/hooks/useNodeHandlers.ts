import { useCallback, useEffect, useState } from 'react';
import { GraphData, GraphNode } from '../types';

interface UseNodeHandlersReturn {
    selectedNode: GraphNode | null;
    handleClearSelection: () => void;
    handleNodeSelect: (node: GraphNode) => void;
}

export function useNodeHandlers(graphData: GraphData): UseNodeHandlersReturn {
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    useEffect(() => {
        if (selectedNode) {
            const updated = graphData.nodes.find(n => n.id === selectedNode.id);
            if (updated && updated !== selectedNode) setSelectedNode(updated);
            else if (!updated) setSelectedNode(null);
        }
    }, [graphData.nodes, selectedNode]);

    return {
        selectedNode,
        handleClearSelection: useCallback(() => setSelectedNode(null), []),
        handleNodeSelect: useCallback((node: GraphNode) => setSelectedNode(node), []),
    };
}
