# FloodPoint

A modern web application for managing ClassPoint session connections and scanning for active sessions.

## Features

- **Flooder**: Create multiple bot connections to ClassPoint sessions
  - Custom bot name prefixes
  - Real-time connection status
  - Batch connect/disconnect

- **Scanner**: Find active ClassPoint sessions
  - Scan class code range (10,000 - 99,999)
  - Auto-stop after 30 minutes
  - Copy found class codes

## Tech Stack

- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **SignalR** - WebSocket connections

## Project Structure

```
floodpoint/
├── app/
│   ├── api/
│   │   ├── classpoint/
│   │   │   └── lookup/route.ts    # Class code lookup
│   │   └── scanner/
│   │       ├── start/route.ts     # Start scan
│   │       ├── stop/route.ts      # Stop scan
│   │       └── results/route.ts   # Get results
│   ├── scanner/
│   │   └── page.tsx               # Scanner page
│   ├── page.tsx                   # Flooder page
│   ├── layout.tsx                 # Root layout
│   └── globals.css                # Global styles
├── components/
│   ├── ui/                        # shadcn/ui components
│   ├── navigation.tsx             # Navigation tabs
│   ├── footer.tsx                 # Footer
│   ├── connection-list.tsx        # Bot connections list
│   └── scan-results-list.tsx      # Scan results list
├── hooks/
│   ├── use-flooder.ts             # Flooder state & logic
│   └── use-scanner.ts             # Scanner state & logic
└── src/
    ├── lib/
    │   ├── scanner.ts             # Scanner core logic
    │   └── classpoint.ts          # ClassPoint API
    ├── config.ts                  # Configuration
    ├── types.ts                   # TypeScript types
    └── utils.ts                   # Utilities
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/InsanelyAvner/floodpoint.git
cd floodpoint

# Install dependencies
npm install

# Start development server
npm run dev
```

### Docker

```bash
# Build and run with Docker Compose
docker-compose up --build
```

## Configuration

Edit `src/config.ts` to customize:

```typescript
// Scanner settings
SCANNER_CONFIG = {
  START_CODE: 10000,
  END_CODE: 99999,
  WEBSOCKET_COLLECT_DURATION: 5000,
  COLLECT_ONLY_DOMAIN: "", // Filter by email domain
}

// Connection settings
CONNECTION_CONFIG = {
  MAX_CONNECTIONS: 100,
  MAX_NAME_PREFIX_LENGTH: 20,
}
```

## API Reference

### GET /api/classpoint/lookup?code={code}
Look up class information by code.

### POST /api/scanner/start
Start scanning for active sessions.
```json
{ "start": 10000, "end": 99999 }
```

### POST /api/scanner/stop
Stop the current scan.

### GET /api/scanner/results
Get scan results and status.

## License

GPL-3.0 - See [LICENSE](LICENSE)

## Author

Built by [InsanelyAvner](https://github.com/InsanelyAvner)