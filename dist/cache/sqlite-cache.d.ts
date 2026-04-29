import { FileAnalysis } from '../types';
export declare class SqliteCache {
    private db;
    constructor(dbPath?: string);
    private init;
    save(analysis: FileAnalysis): void;
    get(filePath: string): FileAnalysis | null;
    getAll(): FileAnalysis[];
    getRatingHistory(filePath: string, limit?: number): Array<{
        rating: number;
        recorded_at: number;
    }>;
    getOverallRating(): number;
    close(): void;
}
//# sourceMappingURL=sqlite-cache.d.ts.map