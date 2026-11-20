export function escapeCypherString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

export interface CandidateQueryInput {
  readonly name: string;
  readonly qualifiedOwner?: string;
  readonly definitions?: boolean;
  readonly implementations?: boolean;
  readonly typeReferences?: boolean;
  readonly kind?: string;
  readonly argumentCount?: number;
  readonly sourceFile?: string;
  readonly sourceLine?: number;
}

export interface DeclarationRelationsQueryInput {
  readonly name: string;
  readonly kind: 'type' | 'method' | 'constructor' | 'field';
  readonly qualifiedOwner: string;
  readonly argumentCount?: number;
  readonly sourceFile?: string;
  readonly sourceLine?: number;
}

export interface DeclarationRelationQueries {
  readonly selected: string;
  readonly declarations?: string;
  readonly implementations?: string;
}

function sourceRangePredicate(input: DeclarationRelationsQueryInput): string {
  return Number.isInteger(input.sourceLine) && input.sourceLine! > 0
    ? ` AND selected.start_line <= ${input.sourceLine} AND selected.end_line >= ${input.sourceLine}`
    : '';
}

function memberProjection(
  member: string,
  occurrence?: { readonly source: string; readonly line: string; readonly edge: string },
): string {
  const occurrenceProjection = occurrence
    ? `, ${occurrence.source}.file_path AS occurrence_file, ${occurrence.line} AS occurrence_line, ${occurrence.edge}.confidence AS confidence, ${occurrence.edge}.strategy AS strategy`
    : '';
  return `RETURN ${member}.qualified_name AS member_qn, ${member}.label AS member_label, ${member}.file_path AS member_file, ${member}.start_line AS member_start_line, ${member}.end_line AS member_end_line, ${member}.signature AS member_signature, ${member}.concrete AS member_concrete${occurrenceProjection} LIMIT 5000`;
}

/** Resolves each declaration-family direction independently to avoid optional-match products. */
export function buildDeclarationRelationQueries(input: DeclarationRelationsQueryInput): DeclarationRelationQueries {
  const name = escapeCypherString(input.name);
  const owner = escapeCypherString(input.qualifiedOwner);
  const range = sourceRangePredicate(input);
  if (input.kind === 'type') {
    const selectedAnchor = input.sourceFile
      ? `selected.file_path = '${escapeCypherString(input.sourceFile)}'`
      : `(selected.qualified_name = '${owner}' OR selected.qualified_name ENDS WITH '.${owner}')`;
    const anchor = `MATCH (selected) WHERE selected.name = '${name}' AND selected.label IN ['Class', 'Interface', 'Enum'] AND ${selectedAnchor}${range}`;
    return {
      selected: `${anchor} OPTIONAL MATCH (selectedSource)-[selectedUsage:USAGE]->(selected) ${memberProjection('selected', { source: 'selectedSource', line: 'selectedSource.start_line', edge: 'selectedUsage' })}`,
      declarations: `${anchor} MATCH (selected)-[:IMPLEMENTS|INHERITS*1..8]->(member) ${memberProjection('member')}`,
      implementations: `${anchor} MATCH (member)-[:IMPLEMENTS|INHERITS*1..8]->(selected) ${memberProjection('member')}`,
    };
  }
  if (input.kind === 'field') {
    const member = escapeCypherString(`${input.qualifiedOwner}.${input.name}`);
    const selectedAnchor = input.sourceFile
      ? `selected.file_path = '${escapeCypherString(input.sourceFile)}'`
      : `(selected.qualified_name = '${member}' OR selected.qualified_name ENDS WITH '.${member}')`;
    const anchor = `MATCH (selected:Field) WHERE selected.name = '${name}' AND ${selectedAnchor}${range}`;
    return {
      selected: `${anchor} OPTIONAL MATCH (source)-[usage:USAGE]->(selected) ${memberProjection('selected', { source: 'source', line: 'source.start_line', edge: 'usage' })}`,
    };
  }
  const arity = Number.isInteger(input.argumentCount) && input.argumentCount! >= 0
    ? ` AND selected.param_count = ${input.argumentCount}`
    : '';
  const anchor = input.sourceFile
    ? `MATCH (selected:Method) WHERE selected.name = '${name}' AND selected.file_path = '${escapeCypherString(input.sourceFile)}'${range}${arity}`
    : `MATCH (selectedOwner)-[:DEFINES_METHOD]->(selected:Method) WHERE selected.name = '${name}' AND (selectedOwner.qualified_name = '${owner}' OR selectedOwner.qualified_name ENDS WITH '.${owner}' OR selectedOwner.name = '${owner}')${arity}`;
  return {
    selected: `${anchor} OPTIONAL MATCH (selectedSource)-[selectedCall:CALLS|CALL_REFERENCE]->(selected) ${memberProjection('selected', { source: 'selectedSource', line: 'selectedCall.line', edge: 'selectedCall' })}`,
    declarations: `${anchor} MATCH (selected)-[:OVERRIDE*1..8]->(member) OPTIONAL MATCH (source)-[memberCall:CALLS|CALL_REFERENCE]->(member) ${memberProjection('member', { source: 'source', line: 'memberCall.line', edge: 'memberCall' })}`,
    implementations: `${anchor} MATCH (member)-[:OVERRIDE*1..8]->(selected) OPTIONAL MATCH (source)-[memberCall:CALLS|CALL_REFERENCE]->(member) ${memberProjection('member', { source: 'source', line: 'memberCall.line', edge: 'memberCall' })}`,
  };
}

/** Emits only a fixed, read-only Cypher subset. External values are string literals. */
export function buildCandidateQuery(input: CandidateQueryInput): string {
  const name = escapeCypherString(input.name);
  if (input.typeReferences) {
    return `MATCH (target) MATCH (source)-[r:IMPLEMENTS|INHERITS]->(target) WHERE target.name = '${name}' RETURN target.qualified_name AS qn, target.label AS label, source.file_path AS file, source.start_line AS start_line, source.end_line AS end_line, target.signature AS signature, r.confidence AS confidence, r.strategy AS strategy LIMIT 100`;
  }
  if (input.definitions && input.sourceFile && Number.isInteger(input.sourceLine)) {
    const sourceFile = escapeCypherString(input.sourceFile);
    const arity = Number.isInteger(input.argumentCount) && input.argumentCount! >= 0
      ? ` AND target.param_count = ${input.argumentCount}`
      : '';
    return `MATCH (source)-[r:CALLS|CALL_REFERENCE]->(target) MATCH (owner)-[:DEFINES_METHOD]->(target) WHERE source.file_path = '${sourceFile}' AND target.name = '${name}' AND r.line = ${input.sourceLine}${arity} RETURN target.qualified_name AS qn, target.label AS label, target.file_path AS file, target.start_line AS start_line, target.end_line AS end_line, target.signature AS signature, owner.qualified_name AS receiver_type, owner.label AS owner_kind, target.concrete AS concrete, r.confidence AS confidence, r.strategy AS strategy LIMIT 100`;
  }
  if (!input.implementations) {
    if (input.kind === 'type') {
      return `MATCH (target) MATCH (source)-[r:USAGE]->(target) WHERE target.name = '${name}' AND source.start_line > 0 RETURN target.qualified_name AS qn, target.label AS label, source.file_path AS file, source.start_line AS start_line, source.end_line AS end_line, target.signature AS signature, r.confidence AS confidence, r.strategy AS strategy LIMIT 100`;
    }
    return `MATCH (target:Method) MATCH (source)-[r:CALLS|CALL_REFERENCE|USAGE]->(target) WHERE target.name = '${name}' AND r.line IS NOT NULL RETURN target.qualified_name AS qn, target.label AS label, source.file_path AS file, r.line AS start_line, r.line AS end_line, target.signature AS signature, r.confidence AS confidence, r.strategy AS strategy LIMIT 100`;
  }
  if (input.kind === 'type') {
    return `MATCH (decl) MATCH (s)-[r:IMPLEMENTS|INHERITS]->(decl) WHERE decl.name = '${name}' RETURN s.qualified_name AS qn, s.label AS label, s.file_path AS file, s.start_line AS start_line, s.end_line AS end_line, s.signature AS signature, r.confidence AS confidence, r.strategy AS strategy LIMIT 100`;
  }
  const owner = escapeCypherString(input.qualifiedOwner ?? '');
  const arity = Number.isInteger(input.argumentCount) && input.argumentCount! >= 0
    ? ` AND s.param_count = ${input.argumentCount}`
    : '';
  return `MATCH (declOwner) MATCH (implOwner)-[r:IMPLEMENTS|INHERITS]->(declOwner) MATCH (implOwner)-[:DEFINES_METHOD]->(s) WHERE s.name = '${name}' AND (declOwner.qualified_name = '${owner}' OR declOwner.qualified_name ENDS WITH '.${owner}' OR declOwner.name = '${owner}')${arity} RETURN s.qualified_name AS qn, s.label AS label, s.file_path AS file, s.start_line AS start_line, s.end_line AS end_line, s.signature AS signature, declOwner.qualified_name AS receiver_type, r.confidence AS confidence, r.strategy AS strategy LIMIT 100`;
}
