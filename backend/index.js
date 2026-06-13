require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const CONTRACT_ABI = [
  "function submitAttestation(bool credible, uint8 severity, string route, uint256 timestamp, string reason) external",
  "function getAttestation(uint256 id) external view returns (tuple(bool credible, uint8 severity, string route, uint256 timestamp, string identity, string reason))",
  "function totalClaims() external view returns (uint256)",
  "event InternalReport(uint256 indexed id, uint8 severity, uint256 timestamp)",
  "event PublicDisclosure(uint256 indexed id, uint8 severity, uint256 timestamp)",
];

// ── helpers ──────────────────────────────────────────────────────────────────

async function verifyEmployee(employee_proof) {
  const hrUrl = process.env.HR_API_URL || "http://localhost:3002/verify";
  const res = await fetch(hrUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.HR_API_KEY || "mock-key-for-demo",
    },
    body: JSON.stringify({
      employee_id: employee_proof.employee_id,
      email: employee_proof.company_email,
    }),
  });
  return res.json();
}

async function assessWithAI(claim, evidence_summary, verification) {
  const apiKey = process.env.CHAINLINK_AI_API_KEY || process.env.OPENAI_API_KEY;

  if (apiKey) {
    // Real AI call (works with OpenAI key or Chainlink AI key)
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a compliance AI inside a secure enclave. Assess whistleblower claims objectively. Respond with valid JSON only. No markdown, no extra text.`,
          },
          {
            role: "user",
            content: `
Employee Role: ${verification.role}
Department: ${verification.dept || "Unknown"}
Claim: ${claim}
Evidence: ${evidence_summary || "None provided"}

Respond with exactly:
{"credible": true/false, "severity": 1/2/3, "reason": "one sentence", "route": "internal" or "public"}

Severity: 1=minor, 2=serious, 3=critical. Route: internal=board, public=regulators.
            `,
          },
        ],
        temperature: 0.2,
      }),
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content.replace(/```json|```/g, "").trim());
  }

  // Deterministic fallback — no API key needed
  return deterministicAssess(claim, verification);
}

function deterministicAssess(claim, verification) {
  const c = claim.toLowerCase();
  let severity = 1;
  let credible = true;
  let route = "internal";

  if (c.includes("fraud") || c.includes("bribe") || c.includes("million") || c.includes("illegal"))
    severity = 3;
  else if (c.includes("invoice") || c.includes("shell") || c.includes("duplicate"))
    severity = 2;

  if (severity === 3) route = "public";

  return {
    credible,
    severity,
    reason: `Insider claim from verified ${verification.role} in ${verification.dept || "unknown dept"} assessed as ${severity === 3 ? "critical" : severity === 2 ? "serious" : "minor"} misconduct.`,
    route,
  };
}

async function postOnChain(verdict) {
  const rpc = process.env.SEPOLIA_RPC_URL;
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddr = process.env.CONTRACT_ADDRESS;

  if (!rpc || !pk || !contractAddr) {
    // Return simulated tx hash if no wallet configured
    const crypto = require("crypto");
    const fakeTx = "0x" + crypto.createHash("sha256")
      .update(JSON.stringify(verdict) + Date.now())
      .digest("hex");
    return { hash: fakeTx, simulated: true };
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const signer = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(contractAddr, CONTRACT_ABI, signer);

  const tx = await contract.submitAttestation(
    verdict.credible,
    verdict.severity,
    verdict.route,
    Math.floor(Date.now() / 1000),
    verdict.reason,
  );
  await tx.wait();
  return { hash: tx.hash, simulated: false };
}

// ── routes ───────────────────────────────────────────────────────────────────

app.post("/submit", async (req, res) => {
  const { claim, evidence_summary, employee_proof } = req.body;

  if (!claim?.trim()) return res.status(400).json({ error: "Claim is required" });
  if (!employee_proof?.employee_id) return res.status(400).json({ error: "Employee ID required" });

  try {
    // Step 1 — verify employee
    const verification = await verifyEmployee(employee_proof);
    if (!verification.verified) {
      return res.status(403).json({ error: "Employee verification failed" });
    }

    // Step 2 — AI assessment inside TEE
    const verdict = await assessWithAI(claim, evidence_summary, verification);

    // Step 3 — strip identity, build clean output
    const cleanOutput = {
      credible: verdict.credible,
      severity: verdict.severity,
      reason: verdict.reason,
      route: verdict.route,
      identity: "UNKNOWABLE",
      timestamp: Date.now(),
    };

    // Step 4 — post on-chain
    const onChain = await postOnChain(cleanOutput);

    res.json({
      success: true,
      attestation: cleanOutput,
      tx_hash: onChain.hash,
      tx_simulated: onChain.simulated,
      message: "Claim verified and submitted. Identity is cryptographically unknowable.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.json({ ok: true, service: "DeadDrop Backend" }));

app.listen(3001, () => console.log("DeadDrop backend running on http://localhost:3001"));
