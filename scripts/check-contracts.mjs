import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const examplesDir = new URL("../examples/", import.meta.url);
const schemasDir = new URL("../schemas/", import.meta.url);
const examplesPath = fileURLToPath(examplesDir);
const schemasPath = fileURLToPath(schemasDir);
const names = (await readdir(examplesDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

const secretKey = /(api[-_]?key|token|password|secret|credential)/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectSecrets(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!secretKey.test(key), `embedded credential-like field at ${path}.${key}`);
    inspectSecrets(child, `${path}.${key}`);
  }
}

function checkProposal(doc) {
  assert(doc.status === "proposed", "proposal status must be proposed");
  assert(doc.action && doc.risk && doc.route, "proposal sections are required");
  assert(
    typeof doc.grounding?.confidence === "number"
      && doc.grounding.confidence >= 0
      && doc.grounding.confidence <= 1,
    "grounding confidence must be between 0 and 1",
  );

  const causesSideEffect = doc.risk.mutation || doc.risk.external_side_effect;
  if (causesSideEffect || doc.risk.level === "high") {
    assert(
      doc.risk.requires_confirmation === true,
      "mutation, external side effects, and high risk require confirmation",
    );
  }
  if (doc.risk.level === "blocked") {
    assert(
      doc.route.approved === false,
      "a blocked proposal cannot have an approved route",
    );
  }
  if (doc.route.runtime === "supercomputer") {
    assert(
      doc.route.approved === true,
      "a Supercomputer route must be explicitly approved",
    );
  }
  inspectSecrets(doc.action.input);
}

function checkDecision(doc) {
  assert(
    ["approved", "rejected", "blocked"].includes(doc.decision),
    "decision must be approved, rejected, or blocked",
  );
  assert(
    ["human", "policy"].includes(doc.actor?.type),
    "decision actor must be human or policy",
  );
  assert(Boolean(doc.reason), "decision reason is required");
}

function checkResult(doc) {
  assert(Array.isArray(doc.evidence), "result evidence must be an array");
  if (doc.executed) {
    assert(doc.evidence.length > 0, "executed actions require evidence");
    assert(
      ["succeeded", "failed"].includes(doc.status),
      "executed actions must succeed or fail",
    );
  } else {
    assert(
      ["blocked", "cancelled"].includes(doc.status),
      "non-executed actions must be blocked or cancelled",
    );
  }
  if (doc.completion_claim_allowed) {
    assert(doc.status === "succeeded", "completion claims require success");
    assert(doc.evidence.length > 0, "completion claims require evidence");
  }
  inspectSecrets(doc.evidence);
}

for (const name of names) {
  const raw = await readFile(join(examplesPath, name), "utf8");
  const doc = JSON.parse(raw);
  if (doc.schema === "tarx-action-proposal.v1") checkProposal(doc);
  else if (doc.schema === "tarx-action-decision.v1") checkDecision(doc);
  else if (doc.schema === "tarx-action-result.v1") checkResult(doc);
  else throw new Error(`${name}: unknown schema ${doc.schema}`);
}

for (const name of await readdir(schemasDir)) {
  if (!name.endsWith(".json")) continue;
  const schema = JSON.parse(await readFile(join(schemasPath, name), "utf8"));
  assert(
    schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `${name}: expected JSON Schema draft 2020-12`,
  );
  assert(Boolean(schema.$id), `${name}: schema id is required`);
}

console.log(`${names.length} contract fixtures passed`);
