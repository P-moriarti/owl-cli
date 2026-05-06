import {
  QueryType,
  type ClassificationResult,
  type RetrievalConfig,
} from "../types/architecture.js";

interface QueryPattern {
  type: QueryType;
  patterns: RegExp[];
  weight: number;
}

const QUERY_PATTERNS: QueryPattern[] = [
  {
    type: QueryType.HOW_TO,
    patterns: [
      /\b(how (do|can|to|would|should)|what's? the (way|best)|show me|explain how)\b/i,
      /\b(create|add|set up|implement|enable)\s+(a|an|the)?\s+(table|policy|function|trigger|view|index)\b/i,
      /\b(get|make|build|setup)\s+(started|working)\b/i,
    ],
    weight: 1.0,
  },
  {
    type: QueryType.PERFORMANCE,
    patterns: [
      /\b(slow|fast|performance|optimize|speed|index|explain|analyze)\b/i,
      /\b(sequential scan|full table scan|improve|speed up)\b/i,
    ],
    weight: 1.2,
  },
  {
    type: QueryType.FIX_SQL,
    patterns: [
      /\b(fix|correct|debug|error|broken|failing|wrong|issue|problem)\b/i,
      /\b(syntax error|constraint violation|failed|exception)\b/i,
    ],
    weight: 1.0,
  },
  {
    type: QueryType.SCHEMA_DESIGN,
    patterns: [
      /\b(should i|best practice|design|relationship|foreign key|primary key)\b/i,
      /\b(one-to-many|many-to-many|database design|schema design)\b/i,
    ],
    weight: 1.0,
  },
  { type: QueryType.GENERAL, patterns: [/.*/], weight: 0.1 },
];

const SQL_INDICATORS = [
  /```\s*sql/i,
  /SELECT\s+.+FROM\s+/i,
  /INSERT\s+INTO\s+/i,
  /UPDATE\s+\w+\s+SET\s+/i,
  /CREATE\s+(TABLE|INDEX|POLICY)\s+/i,
  /ALTER\s+TABLE\s+/i,
];

export function classifyQuery(query: string): ClassificationResult {
  const scores = new Map<QueryType, number>();
  for (const t of Object.values(QueryType)) {
    if (typeof t === "string") continue;
    scores.set(t as QueryType, 0);
  }
  const keywords: string[] = [];

  for (const { type, patterns, weight } of QUERY_PATTERNS) {
    for (const re of patterns) {
      if (re.test(query)) {
        scores.set(type, (scores.get(type) ?? 0) + weight);
        keywords.push(re.source.slice(0, 40));
      }
    }
  }
  if (SQL_INDICATORS.some((p) => p.test(query))) {
    scores.set(QueryType.FIX_SQL, (scores.get(QueryType.FIX_SQL) ?? 0) + 2);
    keywords.push("sql");
  }

  let bestType = QueryType.GENERAL;
  let maxScore = 0;
  for (const [type, score] of scores.entries()) {
    if (score > maxScore) {
      maxScore = score;
      bestType = type;
    }
  }
  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? Math.min(maxScore / total, 1) : 0;

  return {
    type: bestType,
    confidence,
    keywords: [...new Set(keywords)].slice(0, 5),
  };
}

export function getRetrievalConfig(type: QueryType): RetrievalConfig {
  switch (type) {
    case QueryType.HOW_TO:
      return {
        knowledgeBaseChunks: 8,
        schemaTables: 5,
        chatHistoryTurns: 3,
        includeSummaries: false,
        priorityDocs: ["guides", "rls"],
      };
    case QueryType.PERFORMANCE:
      return {
        knowledgeBaseChunks: 6,
        schemaTables: 10,
        chatHistoryTurns: 2,
        includeSummaries: true,
        priorityDocs: ["performance", "indexes"],
      };
    case QueryType.FIX_SQL:
      return {
        knowledgeBaseChunks: 4,
        schemaTables: 8,
        chatHistoryTurns: 3,
        includeSummaries: true,
        priorityDocs: ["migrations", "rls"],
      };
    case QueryType.SCHEMA_DESIGN:
      return {
        knowledgeBaseChunks: 6,
        schemaTables: 12,
        chatHistoryTurns: 2,
        includeSummaries: false,
        priorityDocs: ["best-practices"],
      };
    default:
      return {
        knowledgeBaseChunks: 5,
        schemaTables: 5,
        chatHistoryTurns: 3,
        includeSummaries: false,
        priorityDocs: [],
      };
  }
}

export function getQueryTypeLabel(type: QueryType): string {
  const labels: Record<QueryType, string> = {
    [QueryType.HOW_TO]: "How-To",
    [QueryType.PERFORMANCE]: "Performance",
    [QueryType.FIX_SQL]: "Fix SQL",
    [QueryType.SCHEMA_DESIGN]: "Schema Design",
    [QueryType.GENERAL]: "General",
  };
  return labels[type] ?? "General";
}
