export interface WorkspaceReader {
  search(handle: string, query: string, limit: number): string;
  read(handle: string, path: string, maxBytes: number): string;
}
