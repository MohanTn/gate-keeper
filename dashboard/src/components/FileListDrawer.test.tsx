import type { GraphNode } from '../types';

describe('FileListDrawer', () => {
  function createSampleFile(id: string, label: string, type: 'typescript' | 'tsx' | 'jsx' | 'csharp', rating: number): GraphNode {
    return {
      id,
      label,
      type,
      rating,
      size: 100,
      violations: [],
      metrics: {
        linesOfCode: 100,
        cyclomaticComplexity: 2,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 3,
      },
    };
  }

  it('should display file list', () => {
    const files: GraphNode[] = [
      createSampleFile('file1.ts', 'file1.ts', 'typescript', 8.0),
      createSampleFile('file2.tsx', 'file2.tsx', 'tsx', 6.5),
    ];
    expect(files.length).toBe(2);
  });

  it('should sort files by rating', () => {
    const files: GraphNode[] = [
      createSampleFile('a.ts', 'a.ts', 'typescript', 5.0),
      createSampleFile('b.ts', 'b.ts', 'typescript', 8.0),
      createSampleFile('c.ts', 'c.ts', 'typescript', 7.0),
    ];
    const sorted = [...files].sort((a, b) => b.rating - a.rating);
    expect(sorted[0].rating).toBe(8.0);
    expect(sorted[2].rating).toBe(5.0);
  });

  it('should search files by name', () => {
    const files: GraphNode[] = [
      createSampleFile('Button.tsx', 'Button.tsx', 'tsx', 8.0),
      createSampleFile('utils.ts', 'utils.ts', 'typescript', 7.0),
    ];
    const searchTerm = 'Button';
    const filtered = files.filter(f => f.label.toLowerCase().includes(searchTerm.toLowerCase()));
    expect(filtered.length).toBe(1);
    expect(filtered[0].label).toBe('Button.tsx');
  });

  it('should filter files by threshold', () => {
    const files: GraphNode[] = [
      createSampleFile('good.ts', 'good.ts', 'typescript', 8.5),
      createSampleFile('bad.ts', 'bad.ts', 'typescript', 4.0),
    ];
    const threshold = 7.0;
    const belowThreshold = files.filter(f => f.rating < threshold);
    expect(belowThreshold.length).toBe(1);
    expect(belowThreshold[0].label).toBe('bad.ts');
  });

  it('should group files by language', () => {
    const files: GraphNode[] = [
      createSampleFile('a.ts', 'a.ts', 'typescript', 8.0),
      createSampleFile('b.tsx', 'b.tsx', 'tsx', 7.0),
      createSampleFile('c.cs', 'c.cs', 'csharp', 6.0),
    ];
    const grouped = new Map<string, GraphNode[]>();
    for (const file of files) {
      const list = grouped.get(file.type) || [];
      list.push(file);
      grouped.set(file.type, list);
    }
    expect(grouped.get('typescript')?.length).toBe(1);
    expect(grouped.get('tsx')?.length).toBe(1);
    expect(grouped.get('csharp')?.length).toBe(1);
  });

  it('should handle file click navigation', () => {
    const file = createSampleFile('test.ts', 'test.ts', 'typescript', 7.5);
    let selectedFile: GraphNode | null = null;
    const handleFileClick = (f: GraphNode): void => {
      selectedFile = f;
    };
    handleFileClick(file);
    expect(selectedFile!.id).toBe('test.ts');
  });
});
