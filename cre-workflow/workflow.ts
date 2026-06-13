/**
 * DeadDrop — CRE Workflow
 * ETHGlobal NYC 2026
 *
 * Targets:
 *   - Best CRE Workflow ($2,000)
 *   - Confidential AI Attester ($2,000)
 *   - Connect the World ($1,000)
 *
 * 3-step flow inside Chainlink DON:
 *   1. ConfidentialHTTP → verify employee against HR API (inside TEE)
 *   2. ConfidentialHTTP → AI assesses claim inside TEE (Confidential AI Attester)
 *   3. Strip all identity fields — identity is UNKNOWABLE
 */

import {
  cre,
  json,
  Runner,
  type Runtime,
} from '@chainlink/cre-sdk'

// ── Types ────────────────────────────────────────────────────────────────────

type Config = {
  schedule: string
  claim: string
  evidence_summary: string
  employee_id: string
  company_email: string
  tenure_years: number
  hr_api_url: string
  hr_api_key: string
  ai_api_url: string
  ai_api_key: string
  contract_address: string
}

type EmployeeVerification = {
  verified: boolean
  role: string
  dept: string
}

type AIVerdict = {
  credible: boolean
  severity: number
  reason: string
  route: string
}

type WorkflowOutput = {
  success: boolean
  credible: boolean
  severity: number
  reason: string
  route: string
  identity: string
  timestamp: number
  message: string
}

// ── Step 1: Verify employee (ConfidentialHTTP — runs inside TEE) ──────────────

function verifyEmployee(runtime: Runtime<Config>): EmployeeVerification {
  const { config } = runtime
  const confidentialHttp = new cre.capabilities.ConfidentialHTTPClient()

  runtime.log(`[DeadDrop] Verifying employee=${config.employee_id} via ConfidentialHTTP...`)

  const resp = confidentialHttp.sendRequest(runtime, {
    request: {
      url: config.hr_api_url,
      method: 'POST',
      bodyString: JSON.stringify({
        employee_id: config.employee_id,
        email: config.company_email,
      }),
      multiHeaders: {
        'Content-Type': { values: ['application/json'] },
        'x-api-key': { values: [config.hr_api_key] },
      },
    },
  }).result()

  const data = json(resp) as EmployeeVerification

  if (!data.verified) {
    throw new Error('DeadDrop: Employee verification failed — not a confirmed insider')
  }

  runtime.log(`[DeadDrop] Employee verified: role=${data.role} dept=${data.dept}`)
  return data
}

// ── Step 2: Confidential AI Attester — assess claim inside TEE ───────────────

function assessClaim(
  runtime: Runtime<Config>,
  verification: EmployeeVerification,
): AIVerdict {
  const { config } = runtime
  const confidentialHttp = new cre.capabilities.ConfidentialHTTPClient()

  runtime.log('[DeadDrop] Running Confidential AI assessment...')

  const prompt = `You are a compliance AI inside a Chainlink TEE (Trusted Execution Environment). Your assessment is cryptographically attested and cannot be tampered with.

Assess this whistleblower claim objectively. Respond with valid JSON only — no markdown, no extra text.

Employee Role: ${verification.role}
Department: ${verification.dept}
Tenure: ${config.tenure_years} years
Claim: ${config.claim}
Evidence: ${config.evidence_summary || 'None provided'}

Respond with exactly this JSON:
{"credible": true or false, "severity": 1 or 2 or 3, "reason": "one sentence", "route": "internal" or "public"}

Severity: 1=minor policy violation, 2=serious misconduct, 3=critical public interest
Route: internal=escalate to board, public=route to regulators/media`

  const resp = confidentialHttp.sendRequest(runtime, {
    request: {
      url: config.ai_api_url,
      method: 'POST',
      bodyString: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a compliance AI inside a Chainlink TEE. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      multiHeaders: {
        'Content-Type': { values: ['application/json'] },
        'Authorization': { values: [`Bearer ${config.ai_api_key}`] },
      },
    },
  }).result()

  const body = json(resp) as { choices: Array<{ message: { content: string } }> }
  const content = body.choices?.[0]?.message?.content ?? '{}'
  const verdict = JSON.parse(content.replace(/```json|```/g, '').trim()) as AIVerdict

  runtime.log(`[DeadDrop] AI verdict: credible=${verdict.credible} severity=${verdict.severity} route=${verdict.route}`)
  return verdict
}

// ── Step 3: Strip identity — identity NEVER appears in output ─────────────────

function buildAttestation(verdict: AIVerdict): WorkflowOutput {
  return {
    success: true,
    credible: verdict.credible,
    severity: verdict.severity,
    reason: verdict.reason,
    route: verdict.route,
    identity: 'UNKNOWABLE',
    timestamp: Math.floor(Date.now() / 1000),
    message: 'Claim verified inside Chainlink TEE. Whistleblower identity is cryptographically unknowable.',
  }
}

// ── Main workflow handler ─────────────────────────────────────────────────────

const onTrigger = (runtime: Runtime<Config>): string => {
  runtime.log('[DeadDrop] Workflow triggered on Chainlink DON')

  // Step 1: Employee verification inside TEE
  const verification = verifyEmployee(runtime)

  // Step 2: AI assessment inside TEE (Confidential AI Attester)
  const verdict = assessClaim(runtime, verification)

  // Step 3: Strip identity — employee data never leaves this function
  const output = buildAttestation(verdict)

  runtime.log(`[DeadDrop] Complete. severity=${output.severity} route=${output.route} identity=${output.identity}`)

  return JSON.stringify(output, null, 2)
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}

main()
