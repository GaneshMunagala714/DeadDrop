// Mock HR API — simulates employee verification
// In production this is a confidential HTTP call inside the TEE

const express = require("express");
const app = express();
app.use(express.json());

const EMPLOYEES = {
  "EMP-4821": { verified: true, role: "Engineer", dept: "Finance", name: "[REDACTED]" },
  "EMP-1001": { verified: true, role: "Manager", dept: "Operations", name: "[REDACTED]" },
  "EMP-9999": { verified: true, role: "Director", dept: "Legal", name: "[REDACTED]" },
};

app.post("/verify", (req, res) => {
  const { employee_id, email } = req.body;
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) return res.status(401).json({ error: "Missing API key" });
  if (!employee_id) return res.status(400).json({ error: "Missing employee_id" });

  const emp = EMPLOYEES[employee_id];

  if (emp && email?.includes("@")) {
    return res.json({ verified: true, role: emp.role, dept: emp.dept });
  }

  // Unknown ID: still verify as "unverified insider" for demo
  return res.json({ verified: true, role: "Employee", dept: "Unknown" });
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(3002, () => console.log("Mock HR API running on port 3002"));
