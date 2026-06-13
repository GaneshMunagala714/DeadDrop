import {
	type CronPayload,
	cre,
	getNetwork,
	json,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, type Address } from 'viem'
import { z } from 'zod'

// ── Config schema ─────────────────────────────────────────────────────────────

export const configSchema = z.object({
	schedule: z.string(),
	// Whistleblower claim (in production, comes from an HTTP trigger payload or CRE secret)
	claim: z.string(),
	evidenceSummary: z.string(),
	employeeId: z.string(),
	companyEmail: z.string(),
	tenureYears: z.number(),
	// HR verification endpoint (called inside TEE)
	hrApiUrl: z.string(),
	hrApiKey: z.string(),
	// Chainlink Confidential AI Attester endpoint
	aiApiUrl: z.string(),
	aiApiKey: z.string(),
	// On-chain
	registryAddress: z.string(),
	chainSelectorName: z.string(),
	gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

// ── Response types ────────────────────────────────────────────────────────────

interface EmployeeVerification {
	verified: boolean
	role: string
	dept: string
}

interface AIVerdict {
	credible: boolean
	severity: number   // 1 = minor, 2 = serious, 3 = critical public interest
	route: string      // "internal" | "public"
	reason: string
}

// ── Step 1: Verify employee via Confidential HTTP (inside TEE) ────────────────

const fetchEmployeeVerification = (runtime: Runtime<Config>): EmployeeVerification => {
	const { config } = runtime
	const confidentialHttp = new cre.capabilities.ConfidentialHTTPClient()

	runtime.log(`[DeadDrop] Verifying employee=${config.employeeId} via ConfidentialHTTP`)

	const resp = confidentialHttp.sendRequest(runtime, {
		request: {
			url: config.hrApiUrl,
			method: 'POST',
			bodyString: JSON.stringify({
				employee_id: config.employeeId,
				email: config.companyEmail,
			}),
			multiHeaders: {
				'Content-Type': { values: ['application/json'] },
				'x-api-key': { values: [config.hrApiKey] },
			},
		},
	}).result()

	const data = json(resp) as EmployeeVerification

	if (!data.verified) {
		throw new Error('[DeadDrop] Employee not verified — claim rejected')
	}

	runtime.log(`[DeadDrop] Employee verified: role=${data.role} dept=${data.dept}`)
	return data
}

// ── Step 2: Confidential AI Attester — assess inside TEE ─────────────────────

const assessClaim = (runtime: Runtime<Config>, verification: EmployeeVerification): AIVerdict => {
	const { config } = runtime
	const confidentialHttp = new cre.capabilities.ConfidentialHTTPClient()

	runtime.log('[DeadDrop] Running Confidential AI assessment inside TEE...')

	const prompt = `You are a compliance AI inside a Chainlink Trusted Execution Environment (TEE). Your verdict is cryptographically attested and tamper-proof.

Assess this whistleblower claim. Respond with valid JSON only — no markdown, no extra text.

Employee Role: ${verification.role}
Department: ${verification.dept}
Tenure: ${config.tenureYears} years
Claim: ${config.claim}
Evidence: ${config.evidenceSummary || 'None provided'}

Respond with exactly this JSON and nothing else:
{"credible": true or false, "severity": 1 or 2 or 3, "reason": "one sentence max", "route": "internal" or "public"}

Severity scale: 1=minor policy violation, 2=serious misconduct, 3=critical public interest
Route: internal=escalate to board only, public=route to regulators or media`

	const resp = confidentialHttp.sendRequest(runtime, {
		request: {
			url: `${config.aiApiUrl}/v1/chat/completions`,
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
				'Authorization': { values: [`Bearer ${config.aiApiKey}`] },
			},
		},
	}).result()

	const body = json(resp) as { choices: Array<{ message: { content: string } }> }
	const content = body.choices?.[0]?.message?.content ?? '{}'
	const verdict = JSON.parse(content.replace(/```json|```/g, '').trim()) as AIVerdict

	runtime.log(`[DeadDrop] AI verdict: credible=${verdict.credible} severity=${verdict.severity} route=${verdict.route}`)
	return verdict
}

// ── Step 3: Write verdict on-chain via EVMClient writeReport ──────────────────
// DeadDropRegistry.onReport decodes these bytes and emits InternalReport / PublicDisclosure

const writeVerdictOnChain = (runtime: Runtime<Config>, verdict: AIVerdict): string => {
	const { config } = runtime

	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`[DeadDrop] Network not found: ${config.chainSelectorName}`)
	}

	// ABI-encode the verdict fields — matches abi.decode in DeadDropRegistry.onReport
	const encodedPayload = encodeAbiParameters(
		[
			{ name: 'credible', type: 'bool' },
			{ name: 'severity', type: 'uint8' },
			{ name: 'route', type: 'string' },
			{ name: 'reason', type: 'string' },
			{ name: 'timestamp', type: 'uint256' },
		],
		[
			verdict.credible,
			verdict.severity,
			verdict.route,
			verdict.reason,
			BigInt(Math.floor(Date.now() / 1000)),
		],
	)

	// DON nodes reach consensus on the signed report
	const reportResponse = runtime.report(prepareReportRequest(encodedPayload)).result()

	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

	runtime.log(`[DeadDrop] Writing report to DeadDropRegistry at ${config.registryAddress}`)

	const result = evmClient.writeReport(runtime, {
		receiver: config.registryAddress as Address,
		report: reportResponse,
		gasConfig: { gasLimit: config.gasLimit },
	}).result()

	if (result.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`[DeadDrop] On-chain write failed: ${result.errorMessage ?? result.txStatus}`)
	}

	const txHash = result.txHash ? Buffer.from(result.txHash).toString('hex') : 'unknown'
	runtime.log(`[DeadDrop] On-chain write succeeded: txHash=0x${txHash}`)

	return `0x${txHash}`
}

// ── Cron trigger handler ──────────────────────────────────────────────────────

export const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('[DeadDrop] Missing scheduledExecutionTime')
	}

	runtime.log('[DeadDrop] Workflow triggered on Chainlink DON')

	// Step 1: Verify employee inside TEE (identity stays confidential)
	const verification = fetchEmployeeVerification(runtime)

	// Step 2: AI assesses claim inside TEE (Confidential AI Attester)
	const verdict = assessClaim(runtime, verification)

	// Step 3: Write verdict on-chain — identity is UNKNOWABLE
	const txHash = writeVerdictOnChain(runtime, verdict)

	const output = {
		credible: verdict.credible,
		severity: verdict.severity,
		route: verdict.route,
		identity: 'UNKNOWABLE',
		txHash,
	}

	runtime.log(`[DeadDrop] Complete: ${JSON.stringify(output)}`)
	return JSON.stringify(output, null, 2)
}

// ── Workflow init ─────────────────────────────────────────────────────────────

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handler(
			cronTrigger.trigger({ schedule: config.schedule }),
			onCronTrigger,
		),
	]
}
