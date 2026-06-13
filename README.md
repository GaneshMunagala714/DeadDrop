# DeadDrop — Confidential Whistleblowing on Chainlink

> ETHGlobal NYC 2026 · Targeting $5,000 in Chainlink prizes

A trustless whistleblowing platform where employee identity is **cryptographically unknowable**. Claims are verified and assessed inside a Chainlink TEE, then attested on-chain — with zero PII ever leaving the enclave.

---

## Prize Targets

| Prize | Category | Amount |
|-------|----------|--------|
| Best CRE Workflow | Chainlink Runtime Environment | $2,000 |
| Confidential AI Attester | TEE-based AI inference | $2,000 |
| Connect the World | Cross-chain deployment | $1,000 |

---

## How It Works

```
Whistleblower submits claim
        │
        ▼
┌─────────────────────────────────────────┐
│         Chainlink DON (TEE)             │
│                                         │
│  1. ConfidentialHTTP → HR API           │
│     verify employee inside enclave      │
│                                         │
│  2. ConfidentialHTTP → AI Attester      │
│     assess claim at cldev.cloud         │
│     verdict: credible / severity / route│
│                                         │
│  3. Strip identity → UNKNOWABLE         │
│                                         │
│  4. EVMClient.writeReport()             │
│     → DeadDropRegistry on Sepolia       │
└─────────────────────────────────────────┘
        │
        ▼
DeadDropRegistry.sol emits:
  InternalReport   (severity 1-2) → board
  PublicDisclosure (severity 3)   → regulators / media
```

---

## Repository Structure

```
DeadDrop/
├── workflow/                    # Chainlink CRE Workflow (main prize entry)
│   ├── workflow.ts              # 3-step: verify → AI assess → on-chain write
│   ├── main.ts                  # CRE Runner entrypoint
│   ├── workflow.yaml            # CRE CLI config
│   └── config.staging.json      # Staging config (Sepolia)
│
├── contracts/
│   └── DeadDropRegistry.sol     # Deployed on Sepolia — receives CRE reports
│
├── backend/
│   ├── index.js                 # Express API (fallback submission path)
│   └── mock-hr.js               # Mock HR verification server
│
├── frontend/
│   └── index.html               # Whistleblower submission UI
│
└── cre-workflow/                # Standalone CRE workflow (alternate entry)
    └── workflow.ts
```

---

## Smart Contract

**DeadDropRegistry** deployed on Sepolia:
```
0x2aa4206aa0b9d2434fa96c5330c17fc23709f597
```
[View on Etherscan](https://sepolia.etherscan.io/address/0x2aa4206aa0b9d2434fa96c5330c17fc23709f597)

Implements `IReceiver` — receives signed reports from the Chainlink DON via `onReport(bytes metadata, bytes report)`.

---

## CRE Workflow

The core of the project lives in `workflow/workflow.ts`.

**Step 1 — Employee Verification (inside TEE)**
```typescript
const confidentialHttp = new cre.capabilities.ConfidentialHTTPClient()
// POST to HR API — employee identity stays inside the enclave
```

**Step 2 — Confidential AI Attester**
```typescript
// POST to confidential-ai-dev-preview.cldev.cloud
// AI assesses claim severity inside TEE — cryptographically attested
```

**Step 3 — On-chain Write**
```typescript
const encodedPayload = encodeAbiParameters([...], [credible, severity, route, reason, timestamp])
const report = runtime.report(prepareReportRequest(encodedPayload)).result()
evmClient.writeReport(runtime, { receiver: registryAddress, report })
```

### Simulate locally

```bash
# Install CRE CLI (binary)
# Download from github.com/smartcontractkit/cre — place in ~/bin/cre

cd workflow
npm install

CRE_API_KEY=your_key ~/bin/cre workflow simulate . 
```

---

## Backend

```bash
cd backend
npm install

# Start mock HR server
node mock-hr.js        # runs on :3002

# Start API server  
node index.js          # runs on :3001
```

**Test submission:**
```bash
curl -X POST http://localhost:3001/submit \
  -H "Content-Type: application/json" \
  -d '{
    "claim": "My manager approved fraudulent invoices",
    "employee_id": "EMP-4821",
    "company_email": "test@acmecorp.com"
  }'
```

---

## Frontend

Open `frontend/index.html` directly in a browser — no build step needed.

---

## Tech Stack

- **Chainlink CRE SDK** `@chainlink/cre-sdk` — workflow orchestration
- **Chainlink Confidential AI** `confidential-ai-dev-preview.cldev.cloud` — TEE inference
- **Solidity 0.8.19** — DeadDropRegistry with IReceiver
- **viem** — ABI encoding for on-chain report payload
- **zod** — runtime config validation
- **Express.js** — backend API
- **Sepolia** — testnet deployment

---

## Team

Built at ETHGlobal NYC 2026
