import type { PackageRecord } from "./contracts.js";

export type SearchMatch = {
  score: number;
  matchedFields: string[];
  highlights: string[];
};

const vectorSize = 48;
const stopWords = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);
const synonymMap: Record<string, string[]> = {
  ai: ["agent", "assistant", "model"],
  auth: ["authentication", "login", "oauth", "token"],
  bundle: ["collection", "pack"],
  code: ["runtime", "execution"],
  connector: ["integration", "provider"],
  docs: ["documentation", "readme"],
  gateway: ["host", "runtime"],
  plugin: ["extension", "connector", "integration"],
  provider: ["connector", "integration"],
  search: ["discovery", "find"],
  skill: ["workflow", "prompt", "agent"],
  tool: ["command", "utility"],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@/._+-]+/g, " ").trim();
}

function tokenize(value: string) {
  return normalize(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !stopWords.has(term));
}

export function expandSearchTerms(query: string) {
  const terms = tokenize(query);
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const synonym of synonymMap[term] ?? []) expanded.add(synonym);
  }
  return [...expanded];
}

export function expandedSearchQuery(query: string) {
  return expandSearchTerms(query).join(" ");
}

function hashTerm(term: string) {
  let hash = 2166136261;
  for (let index = 0; index < term.length; index += 1) {
    hash ^= term.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addVectorTerm(vector: number[], term: string, weight: number) {
  const hash = hashTerm(term);
  const primary = hash % vector.length;
  const secondary = (hash >>> 8) % vector.length;
  vector[primary] = (vector[primary] ?? 0) + weight;
  vector[secondary] = (vector[secondary] ?? 0) + weight * 0.5;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function vectorFor(entries: Array<{ text: string; weight: number }>) {
  const vector = Array.from({ length: vectorSize }, () => 0);
  for (const entry of entries) {
    for (const term of tokenize(entry.text)) addVectorTerm(vector, term, entry.weight);
  }
  return normalizeVector(vector);
}

function cosine(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function fieldText(pkg: PackageRecord) {
  return {
    name: pkg.name,
    displayName: pkg.displayName,
    summary: pkg.summary ?? "",
    owner: pkg.ownerHandle ?? "",
    topics: (pkg.topics ?? []).join(" "),
    capabilities: (pkg.capabilityTags ?? []).join(" "),
    compatibility: [
      pkg.compatibility?.pluginApiRange,
      pkg.compatibility?.minGatewayVersion,
      pkg.compatibility?.builtWithKovaVersion,
      pkg.compatibility?.pluginSdkVersion,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function directMatchScore(field: string, query: string, terms: string[], weight: number) {
  const normalizedField = normalize(field);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  if (normalizedField === normalizedQuery) return weight * 2.2;
  if (normalizedField.includes(normalizedQuery)) return weight * 1.4;
  const matches = terms.filter((term) => normalizedField.includes(term)).length;
  return matches > 0 ? weight * (matches / Math.max(terms.length, 1)) : 0;
}

export function searchPackage(pkg: PackageRecord, query: string, discoveryScore: number): SearchMatch {
  const normalizedQuery = normalize(query);
  const terms = expandSearchTerms(query);
  const fields = fieldText(pkg);
  if (!normalizedQuery || normalizedQuery === "*") {
    return {
      score: 1 + Math.log1p(discoveryScore),
      matchedFields: [],
      highlights: [],
    };
  }

  const weights: Record<keyof ReturnType<typeof fieldText>, number> = {
    name: 70,
    displayName: 52,
    summary: 24,
    owner: 12,
    topics: 34,
    capabilities: 30,
    compatibility: 20,
  };
  const matchedFields: string[] = [];
  let lexicalScore = 0;

  for (const [field, text] of Object.entries(fields) as Array<[keyof typeof fields, string]>) {
    const score = directMatchScore(text, query, terms, weights[field]);
    if (score > 0) {
      matchedFields.push(field);
      lexicalScore += score;
    }
  }

  const queryVector = vectorFor([{ text: expandedSearchQuery(query), weight: 1 }]);
  const packageVector = vectorFor([
    { text: fields.name, weight: 3 },
    { text: fields.displayName, weight: 2.5 },
    { text: fields.topics, weight: 2 },
    { text: fields.capabilities, weight: 1.8 },
    { text: fields.summary, weight: 1.2 },
    { text: fields.compatibility, weight: 1 },
  ]);
  const vectorScore = cosine(queryVector, packageVector) * 30;
  const score = lexicalScore + vectorScore + Math.log1p(discoveryScore);
  const highlights = [fields.summary, fields.topics, fields.capabilities]
    .filter((value) => value && terms.some((term) => normalize(value).includes(term)))
    .slice(0, 3);

  return {
    score,
    matchedFields: [...new Set(matchedFields)],
    highlights,
  };
}
