// Types of build-mosaic.mjs, for the rig's TypeScript.
export function readPin(): { repository: string; commit: string };
export function mosaicDir(pin?: { repository: string; commit: string }): string;
export function ensureMosaic(): string;
