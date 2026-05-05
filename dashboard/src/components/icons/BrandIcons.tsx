import React from 'react';

export function ClaudeIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M16.1 3.68l-4.03 16.58a.59.59 0 0 1-.57.46.6.6 0 0 1-.14-.02.59.59 0 0 1-.44-.71L14.95 3.4a.59.59 0 0 1 1.15.28zM8.52 5.12l2.72 4.17-2.1 3.5-4.63-7.67a.59.59 0 0 1 1.01-.59l2.05 3.4L8.52 5.12zm7.69 6.79L21.03 19a.59.59 0 0 1-1.01.6l-4.63-7.68 2.1-3.5-.56.94.33.55-1.05 1.99z" fill="#D97757" />
        </svg>
    );
}

export function CopilotIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-2h2v2zm0-4h-2V7h2v5z" fill="#86EFAC" />
            <path d="M12 4c-1.1 0-2.1.23-3.06.63C10.58 5.54 12 7.6 12 10c0 2.4-1.42 4.46-3.06 5.37A7.96 7.96 0 0 0 12 20a8 8 0 0 0 0-16z" fill="#22C55E" />
            <circle cx="9.5" cy="11" r="1.5" fill="#0B1120" />
            <circle cx="14.5" cy="11" r="1.5" fill="#0B1120" />
        </svg>
    );
}
