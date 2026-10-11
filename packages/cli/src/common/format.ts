/**
 * Formatting helpers for CLI output matching design/prototype/Terminal.dc.html.
 */

export function formatTable(headers: string[], rows: string[][], minPadding = 2): string {
  if (headers.length === 0) {
    return '';
  }

  const numCols = headers.length;
  const colWidths: number[] = headers.map((h) => h.length);

  for (const row of rows) {
    for (let c = 0; c < numCols; c++) {
      const cell = row[c] ?? '';
      if (cell.length > colWidths[c]!) {
        colWidths[c] = cell.length;
      }
    }
  }

  const formatRow = (cells: string[]): string => {
    return cells
      .map((cell, idx) => {
        if (idx === numCols - 1) {
          // Last column has no trailing padding
          return cell;
        }
        const width = (colWidths[idx] ?? cell.length) + minPadding;
        return cell.padEnd(width, ' ');
      })
      .join('');
  };

  const headerLine = formatRow(headers);
  const rowLines = rows.map((r) => formatRow(r));

  return [headerLine, ...rowLines].join('\n');
}

export function formatStatus(status: string): string {
  switch (status) {
    case 'paused':
    case 'paused_limit':
      return 'paused·limit';
    case 'near_limit':
      return 'near·limit';
    case 'signed_out':
      return 'signed·out';
    default:
      return status;
  }
}

export function formatAgentAccount(agent: string, accountSlug: string): string {
  // If accountSlug starts with `${agent}-`, strip it so we get e.g. "claude@personal"
  const prefix = `${agent}-`;
  const cleanSlug = accountSlug.startsWith(prefix) ? accountSlug.slice(prefix.length) : accountSlug;
  return `${agent}@${cleanSlug}`;
}

export function formatTimestampTime(timestamp: string | null): string {
  if (!timestamp) {
    return '—';
  }
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) {
      return timestamp;
    }
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return timestamp;
  }
}
