import { SqliteCache } from '../cache/sqlite-cache';
import { FileAnalysis } from '../types';
export declare class VizServer {
    private app;
    private server;
    private wss;
    private graph;
    private cache;
    private hasAutoOpened;
    constructor(cache: SqliteCache);
    private loadFromCache;
    private setupRoutes;
    private setupWebSocket;
    pushAnalysis(analysis: FileAnalysis): void;
    private broadcast;
    private maybeAutoOpen;
    start(): Promise<void>;
    stop(): void;
}
//# sourceMappingURL=viz-server.d.ts.map