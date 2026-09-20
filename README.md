# Hybrid Data Cleaning Platform (HDCP)

[![Next.js](https://img.shields.io/badge/Next.js-16.2.6-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.6-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![Polars](https://img.shields.io/badge/Polars-nodejs--polars-CD792C?style=flat-square)](https://pola.rs/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM-C5F74F?style=flat-square)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Ready-336791?style=flat-square&logo=postgresql)](https://www.postgresql.org/)

An intelligent, ML-first data profiling and automated cleaning workbench that bridges deterministic data engineering and advanced machine learning preparation. 

Built with **Next.js 16**, **React 19**, and a high-performance **Rust-powered Polars** engine (`nodejs-polars`), this platform enables data scientists and analysts to upload large CSV datasets, profile data hygiene issues instantly, establish goal-aligned cleaning recipes, and execute statistical or machine learning operations with instant rollback and export capabilities.

---

## 📑 Table of Contents

- [Key Highlights](#-key-highlights)
- [System Architecture](#-system-architecture)
- [Core Capabilities](#-core-capabilities)
  - [1. High-Performance Polars Engine](#1-high-performance-polars-engine)
  - [2. Goal-Aligned ML Co-Pilot & Decision Safeguards](#2-goal-aligned-ml-co-pilot--decision-safeguards)
  - [3. Deep Column Profiler & Diagnostics](#3-deep-column-profiler--diagnostics)
  - [4. Recipe Pipeline & 8-Step Undo Stack](#4-recipe-pipeline--8-step-undo-stack)
  - [5. Universal Command Envelope](#5-universal-command-envelope)
- [Technology Stack](#-technology-stack)
- [Directory Structure](#-directory-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
  - [Running the Application](#running-the-application)
- [API Reference](#-api-reference)
- [Universal Cleaning Schema](#-universal-cleaning-schema)
- [License](#-license)

---

## 🌟 Key Highlights

- **Lightning-Fast In-Memory Execution**: Powered by `nodejs-polars` native bindings, processing datasets in sub-second intervals without Python bridge bottlenecks.
- **Rule A vs. Rule B ML Safeguards**:
  - **Rule A (Statistical / Traditional ML)**: Recommends deterministic, robust techniques (KNN Imputer, Isolation Forest, IQR Winsorizing, StandardScaler/MinMaxScaler, Median/Mode imputation).
  - **Rule B (Deep Learning Warnings)**: Automatically flags extreme dimensionality, high-cardinality PII, non-linear anomalies, and unstructured text, requiring explicit human sign-off before running complex pipelines.
- **Objective-Driven Goal Alignment**: Formulate natural language objectives (e.g., *"Predict customer churn with XGBoost"* or *"Forecast quarterly sales"*). The advisor automatically identifies the target variable, detects the task type, and adapts suggestions accordingly.
- **Full State Snapshotting & Instant Undo**: Every transformation creates an immutable snapshot (up to 8 levels deep), allowing zero-risk experimentation with single-click rollbacks.
- **Export Ready**: Exports cleaned, type-coerced datasets directly to CSV with full recipe replay.

---

## 🏛 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client (Browser)                              │
│  ┌───────────────┐   ┌────────────────┐   ┌──────────────────────────┐  │
│  │   Goal Box    │   │ Data Grid &    │   │  AI Co-pilot Rail &      │  │
│  │ (Task/Target) │   │ Profiler Modal │   │  Approve / Reject Cards  │  │
│  └───────┬───────┘   └───────┬────────┘   └────────────┬─────────────┘  │
└──────────┼───────────────────┼─────────────────────────┼────────────────┘
           │                   │                         │
           ▼                   ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Next.js 16 Server API Routes                         │
│  /api/upload  •  /api/analyze_all  •  /api/apply_cleaning  •  /api/chat │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────────────┐   ┌───────────────────────────────────┐
│      Polars Engine (Rust)     │   │      Session Store & Postgres     │
│  - Chunked CSV Ingestion      │   │  - Drizzle ORM Schema             │
│  - KNN Imputer (Multivariate) │   │  - In-Memory DataFrame Registry   │
│  - Isolation Forest Anomaly   │   │  - 8-Depth Snapshot Undo Stack    │
│  - IQR Capping / Winsorizing  │   │  - Persisted Recipe Replay        │
│  - Type Casting & Dedupe      │   │  - Conversational History         │
└───────────────────────────────┘   └───────────────────────────────────┘
```

---

## ⚡ Core Capabilities

### 1. High-Performance Polars Engine
- Utilizes Rust-backed Polars Series and DataFrames.
- Parses diverse null representations (`NA`, `N/A`, `null`, `NaN`, empty strings).
- Performs multivariate calculations natively in memory:
  - **K-Nearest Neighbors (KNN) Imputation**: Standardized Euclidean distance metric using surrounding feature vectors.
  - **Isolation Forest**: Tree-based partition anomaly detection with deterministic seeding for repeatable data cleaning pipelines.
  - **Interquartile Range (IQR) Processing**: Lower/upper bound Winsorizing (capping) and outlier exclusion.
  - **Feature Scaling**: StandardScaler (z-score normalization) and MinMaxScaler.

### 2. Goal-Aligned ML Co-Pilot & Decision Safeguards
- **Goal Specification**: Parses objectives into canonical tasks: `classification`, `regression`, `timeseries`, `clustering`, `nlp`, or `eda`.
- **Target Feature Awareness**: Detects label and target columns to prevent accidental data leakage, incorrect scaling, or invalid row dropping.
- **Complexity Assessment**:
  - **High Dimensionality**: Flags $p/n$ column-to-row ratio risks.
  - **Unstructured Prose**: Detects text columns that require embeddings rather than categorical encoding.
  - **PII Leakage**: Identifies sensitive personal identifiers (emails, SSNs, phone numbers, addresses).
  - **Nonlinear Manifold Anomalies**: Catches severe non-linear anomaly rates ($>12\%$).
  - **Explosive Cardinality**: Warns against one-hot encoding columns with thousands of unique strings.

### 3. Deep Column Profiler & Diagnostics
- Statistical metrics: `min`, `q1`, `median`, `mean`, `q3`, `max`, `std`, and `iqr`.
- Outlier detection summary with visual threshold bounds.
- Frequency histogram bins for numeric columns and value distributions for categorical columns.
- Pattern checks: string-encoded numbers, leading/trailing whitespace leaks, and letter-case collisions (e.g. `"Active"` vs `"active"`).

### 4. Recipe Pipeline & 8-Step Undo Stack
- Every transformation is recorded as a structured `Op` in a persistent recipe sequence.
- State snapshots retain prior DataFrame states in memory.
- Rolling back or resetting restores the previous snapshot instantly without reprocessing from scratch.

### 5. Universal Command Envelope
- Clean, decoupled API surface accepting batch operations from both the user interface and programmatic AI agents:
  ```json
  {
    "datasetId": "dset_abc123",
    "command": {
      "column": "Annual_Income",
      "action_category": "missing_values",
      "method": "knn",
      "params": { "k": 5 }
    }
  }
  ```

---

## 🛠 Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | [Next.js 16.2](https://nextjs.org/) (App Router), [React 19](https://react.dev/) |
| **Styling & UI** | [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React Icons](https://lucide.dev/) |
| **Data Engine** | [nodejs-polars](https://github.com/pola-rs/nodejs-polars) (Rust Apache Arrow engine) |
| **Language & Tooling** | [TypeScript 5.9](https://www.typescriptlang.org/), [ESLint 9](https://eslint.org/) |
| **Database & ORM** | [PostgreSQL](https://www.postgresql.org/), [Drizzle ORM](https://orm.drizzle.team/), `pg` |
| **State & Session** | In-memory session snapshot cache + global singleton registry |

---

## 📂 Directory Structure

```plaintext
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze_all/         # ML-first advisor & complexity detection
│   │   │   ├── apply_cleaning/      # Universal cleaning & undo/reset executor
│   │   │   ├── chat/                # Co-pilot conversational assistant
│   │   │   ├── datasets/            # Dataset CRUD, profiling, ops, and CSV export
│   │   │   ├── health/              # Database health check
│   │   │   └── upload/              # Chunked CSV ingestion & demo dataset seed
│   │   ├── globals.css              # Global styles & Tailwind CSS v4 setup
│   │   ├── layout.tsx               # Root application layout
│   │   └── page.tsx                 # Main interactive workbench view
│   ├── components/
│   │   ├── column-profiler.tsx      # Comprehensive column distribution & stats modal
│   │   ├── copilot.tsx              # AI assistant chat & proposal stream
│   │   ├── data-grid.tsx            # Virtualized tabular data grid with column ops
│   │   ├── empty-state.tsx          # CSV upload drag-and-drop & feature overview
│   │   ├── goal-box.tsx             # Natural language objective input & task tagger
│   │   ├── proposal-card.tsx        # Interactive Approve/Reject suggestion card
│   │   └── toolbar.tsx              # Quick operations, undo button, recipe rail, and export
│   ├── db/
│   │   ├── index.ts                 # Drizzle database client initialization
│   │   └── schema.ts                # Datasets, recipe steps, and chat tables
│   └── lib/
│       ├── commands.ts              # Universal command vocabulary & validator
│       ├── copilot.ts               # Heuristic profiling & conversational routing
│       ├── csv-stream.ts            # CSV line streaming & chunk aggregation
│       ├── ml-advisor.ts            # Rule A / Rule B engine & goal alignment logic
│       ├── polars-engine.ts         # Polars transformations, Isolation Forest & KNN
│       ├── store.ts                 # Session registry & memory snapshot management
│       └── types.ts                 # Shared TypeScript interfaces & types
├── drizzle.config.json              # Drizzle ORM configuration
├── next.config.ts                   # Next.js configuration
├── package.json                     # Dependencies and npm scripts
└── tsconfig.json                    # TypeScript compiler options
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v20.x` or higher
- **npm**, **pnpm**, or **yarn**
- **PostgreSQL**: Local instance or hosted service (Supabase, Neon, AWS RDS, etc.)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Irfanshaikh016/data.git
   cd data
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/cleaning_platform
```

> **Note**: The application operates gracefully in memory even if Postgres is temporarily unreachable, making local testing seamless.

### Database Setup

Synchronize your schema with Postgres using Drizzle:

```bash
npx drizzle-kit push
```

### Running the Application

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To verify type safety and code health:

```bash
npm run typecheck
npm run lint
```

To build for production:

```bash
npm run build
npm run start
```

---

## 📡 API Reference

### Datasets & Ingestion
| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | `POST` | Uploads a CSV file using `multipart/form-data` or loads a demo (`?demo=true`). |
| `/api/datasets` | `GET` | Lists recent dataset sessions. |
| `/api/datasets/:id` | `GET` | Fetches metadata, preview rows, recipe, and active suggestions for a dataset. |
| `/api/datasets/:id/profile` | `GET` | Detailed distribution statistics for a given column (`?column=col_name`). |
| `/api/datasets/:id/export` | `GET` | Downloads the cleaned dataset as a CSV file. |

### ML Co-pilot & Cleaning Engine
| Endpoint | Method | Description |
|---|---|---|
| `/api/datasets/:id/goal` | `POST` | Sets or updates the natural language objective for the dataset. |
| `/api/analyze_all` | `POST` | Runs the full ML Advisor: parses goal, detects Rule B complexity, and generates Rule A proposals. |
| `/api/apply_cleaning` | `POST` | Executes atomic cleaning commands, manages undo snapshots, and applies recipes. |
| `/api/chat` | `POST` | Sends a message to the AI co-pilot for automated problem analysis and actions. |
| `/api/health` | `GET` | Diagnostic check for PostgreSQL and engine availability. |

---

## 🧩 Universal Cleaning Schema

`POST /api/apply_cleaning` accepts unified command envelopes for programmatic automation:

```typescript
interface UniversalCommand {
  column?: string;
  action_category: "missing_values" | "outliers" | "manual_edit" | "types" | "text" | "structure";
  method: string;
  params?: Record<string, unknown>;
}
```

### Supported Categories & Methods

```json
{
  "missing_values": {
    "drop_rows": {},
    "mean": {},
    "median": {},
    "mode": {},
    "forward": {},
    "custom": { "value": "Unknown" },
    "knn": { "k": 5 }
  },
  "outliers": {
    "capping": { "multiplier": 1.5 },
    "drop_rows": { "multiplier": 1.5 }
  },
  "manual_edit": {
    "drop_row": { "index": 0 }
  },
  "types": {
    "cast": { "to": "Float64" }
  },
  "text": {
    "trim": {},
    "lowercase": {},
    "uppercase": {}
  },
  "structure": {
    "dedupe": {},
    "drop_column": {},
    "rename": { "to": "new_name" }
  }
}
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
