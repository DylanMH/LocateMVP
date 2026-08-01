# Locate720 Backend Server

Backend API server for the Locate720 mobile app. Simulates an 811 ticket management system with ticket generation, assignment, and status tracking.

## Features

- **Ticket Generation** - Automatically generates realistic 811 tickets with Illinois addresses
- **REST API** - Full CRUD operations for tickets and users
- **SQLite Database** - Persistent storage with better-sqlite3
- **Ticket Assignment** - Assign tickets to technicians
- **Status Tracking** - Track ticket lifecycle (ASSIGNED → ENROUTE → ONSITE → CLOSED)
- **Statistics** - Get ticket counts and breakdowns by status

## Tech Stack

- Node.js (ES Modules)
- Express.js
- better-sqlite3
- CORS enabled for mobile app

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Seed sample users (optional):**
   ```bash
   npm run seed
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

Server will start on `http://localhost:3000`

## Database

The SQLite database is automatically created at `data/locate720.db` on first run.

**Tables:**
- `users` - Technicians, supervisors, managers
- `tickets` - 811 locate tickets with status and assignment
- `ticket_events` - Audit trail of ticket changes

## API Endpoints

### Tickets

**GET /api/tickets**
- Get all tickets with optional filters
- Query params: `assignedTo`, `status`, `locatorStatus`
- Example: `/api/tickets?status=OPEN&assignedTo=user-123`

**GET /api/tickets/:id**
- Get a single ticket by ID

**POST /api/tickets**
- Generate a new random ticket
- No body required

**PATCH /api/tickets/:id**
- Update ticket fields
- Body: `{ status, locator_status, assigned_tech_id, payload_json }`

**GET /api/tickets/stats/summary**
- Get ticket statistics
- Returns total, open, closed counts and breakdown by locator status

### Users

**GET /api/users**
- Get all users
- Query params: `role` (TRAINEE, TRAINER, TECH, SUPERVISOR, AREA_MANAGER, MANAGER)

**GET /api/users/:id**
- Get a single user by ID

**POST /api/users**
- Create a new user
- Body: `{ name, email, role, supervisorId?, areaId? }`
- Roles: TRAINEE, TRAINER, TECH, SUPERVISOR, AREA_MANAGER, MANAGER
- `supervisorId` establishes the management tree hierarchy

**GET /api/users/:id/tickets**
- Get all tickets assigned to a user

### Role Hierarchy & Permissions

| Role | Level | Can View | Can Edit | Can Clock | Search Scope |
|------|-------|----------|----------|-----------|--------------|
| TRAINEE | 0 | Own tickets only | Limited (notes only) | Yes | Own ticket number |
| TRAINER | 1 | Own + supervised techs | Supervised tickets | Yes | Supervised ticket numbers |
| TECH | 2 | Own tickets | Full | Yes | Own ticket number |
| SUPERVISOR | 3 | Area tickets | Area tickets + clock time | No | Address + ticket number + date range |
| AREA_MANAGER | 4 | Area tickets | Area tickets + staff mgmt | No | Address + ticket number + date range |
| MANAGER | 5 | All tickets | Full system | No | All filters |

Management tree via `supervisor_id`: Trainees → Trainers/Techs → Supervisors → Area Managers → Managers

### Health Check

**GET /api/health**
- Server health check

## Ticket Status Flow

1. **ASSIGNED** - Ticket created and assigned to tech
2. **ENROUTE** - Tech is traveling to location
3. **ONSITE** - Tech has arrived and is working
4. **PAUSED** - Tech temporarily left the site
5. **CLOSED** - Work completed
6. **UNABLE** - Unable to complete (rare)

## Mobile App Integration

The mobile app (Locate720) will:
1. Pull tickets from this API on sync
2. Push status updates and closeout data
3. Handle offline mode with local WatermelonDB
4. Sync changes via outbox pattern

## Development

**Auto-reload on changes:**
```bash
npm run dev
```

**Manual start:**
```bash
npm start
```

## Data Directory

All database files are stored in `data/` which is gitignored.
