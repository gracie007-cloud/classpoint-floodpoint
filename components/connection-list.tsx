import { memo } from "react";
import { List, RowComponentProps } from "react-window";
import type { ConnectionInfo } from "@/src/types";
import { getStatusClasses, truncate } from "@/src/utils";

interface ConnectionListProps {
  connections: ConnectionInfo[];
}

/**
 * Height of each row in pixels
 */
const ROW_HEIGHT = 68;

/**
 * List height in pixels (matches the previous max-h-[320px])
 */
const LIST_HEIGHT = 320;

/**
 * Row props interface
 */
interface ConnectionRowProps {
  data: ConnectionInfo[];
}

/**
 * Individual row component for virtualization
 */
function ConnectionRow({ index, style, data }: RowComponentProps<ConnectionRowProps>): React.ReactElement | null {
  const conn = data[index];
  if (!conn) return null;

  const statusClasses = getStatusClasses(conn.status);
  
  return (
    <div style={style} className="px-4 py-3 border-b border-border bg-card hover:bg-secondary/50 transition-colors duration-150 flex items-center justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {conn.username}
        </p>
        <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
          {truncate(conn.participantId, 28)}
        </p>
      </div>
      <span
        className={`ml-3 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${statusClasses.badge}`}
      >
        {conn.status}
      </span>
    </div>
  );
}

/**
 * Clean connection list with minimal styling and virtualization
 */
export const ConnectionList = memo(function ConnectionList({ connections }: ConnectionListProps) {
  if (connections.length === 0) {
    return null;
  }

  const connectedCount = connections.filter(c => c.status === "Connected").length;
  // Calculate height: minimum of (count * rowHeight) and MAX_HEIGHT
  const listHeight = Math.min(connections.length * ROW_HEIGHT, LIST_HEIGHT);

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">Active Connections</h2>
        <span className="text-xs text-muted-foreground">
          {connectedCount}/{connections.length} connected
        </span>
      </div>
      
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <List
          style={{ height: listHeight, width: "100%" }}
          rowCount={connections.length}
          rowHeight={ROW_HEIGHT}
          rowComponent={ConnectionRow}
          rowProps={{ data: connections }}
          className="custom-scrollbar"
        />
      </div>
    </div>
  );
});

