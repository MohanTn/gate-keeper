// Manual mock for react-force-graph-2d
const React = require('react');

const MockForceGraph = React.forwardRef(function MockForceGraph(props, ref) {
  React.useImperativeHandle(ref, () => ({
    d3Force: jest.fn().mockReturnThis(),
    d3ReheatSimulation: jest.fn(),
    zoomToFit: jest.fn(),
    graphData: jest.fn().mockReturnValue({ nodes: [], links: [] }),
  }));
  return React.createElement('div', { 
    'data-testid': 'mock-force-graph',
    ...props 
  }, 'Mock ForceGraph');
});

module.exports = MockForceGraph;
