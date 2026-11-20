import { describe, expect, it } from 'vitest';
import {
  buildCandidateQuery,
  buildDeclarationRelationQueries,
  escapeCypherString,
} from './queryBuilder.js';

describe('restricted query builder', () => {
  it('anchors a logical member family by owner, name, and arity', () => {
    const queries = buildDeclarationRelationQueries({
      name: 'run', kind: 'method', qualifiedOwner: 'demo.Worker', argumentCount: 1,
      sourceFile: 'src/Worker.java', sourceLine: 12,
    });
    expect(queries.selected).toContain("selected.name = 'run'");
    expect(queries.selected).toContain("selected.file_path = 'src/Worker.java'");
    expect(queries.selected).toContain('selected.start_line <= 12');
    expect(queries.selected).toContain('selected.end_line >= 12');
    expect(queries.selected).toContain('selected.param_count = 1');
    expect(queries.declarations).toContain('(selected)-[:OVERRIDE*1..8]->(member)');
    expect(queries.implementations).toContain('(member)-[:OVERRIDE*1..8]->(selected)');
    for (const query of Object.values(queries).filter((value): value is string => Boolean(value))) {
      expect(query).toContain('CALLS|CALL_REFERENCE');
      expect(query).not.toContain('AS member_relationship');
      expect(query).not.toContain('[call:');
      expect(query).not.toContain(' UNWIND ');
      expect(query).not.toMatch(/\b(CREATE|DELETE|SET|MERGE|REMOVE|DROP)\b/);
    }
  });

  it('escapes quotes, slashes, and line breaks as one Cypher literal', () => {
    expect(escapeCypherString("a\\b'c\nCREATE (n)")).toBe("a\\\\b\\'c\\nCREATE (n)");
  });

  it('keeps external text inside a fixed read-only query template', () => {
    const query = buildCandidateQuery({
      name: "run' MATCH (x) DELETE x //",
      qualifiedOwner: 'demo.Service',
      implementations: true,
    });
    expect(query).toContain("s.name = 'run\\' MATCH (x) DELETE x //' ");
    expect(query).toMatch(/^MATCH /);
    expect(query).not.toMatch(/\n\s*(CREATE|DELETE|SET|MERGE|REMOVE|DROP)\b/);
  });

  it('matches method implementations through the owning type relationship', () => {
    const query = buildCandidateQuery({
      name: 'run', qualifiedOwner: 'demo.Worker', implementations: true,
      kind: 'method', argumentCount: 1,
    });
    expect(query).toContain('MATCH (declOwner) MATCH (implOwner)-[r:IMPLEMENTS|INHERITS]->(declOwner) MATCH (implOwner)-[:DEFINES_METHOD]->(s)');
    expect(query).toContain("declOwner.qualified_name = 'demo.Worker'");
    expect(query).toContain("declOwner.qualified_name ENDS WITH '.demo.Worker'");
    expect(query).toContain("s.name = 'run'");
    expect(query).toContain('s.param_count = 1');
    expect(query).not.toContain('type(r)');
  });

  it('matches type and field declarations with graph-specific qualified-name prefixes', () => {
    const typeQueries = buildDeclarationRelationQueries({
      name: 'Worker', kind: 'type', qualifiedOwner: 'demo.Worker',
    });
    expect(typeQueries.selected).toContain("selected.qualified_name ENDS WITH '.demo.Worker'");
    expect(typeQueries.selected).toContain("selected.label IN ['Class', 'Interface', 'Enum']");
    expect(typeQueries.selected).toContain('selectedUsage:USAGE');
    expect(typeQueries.declarations).toContain('(selected)-[:IMPLEMENTS|INHERITS*1..8]->(member)');
    expect(typeQueries.implementations).toContain('(member)-[:IMPLEMENTS|INHERITS*1..8]->(selected)');
    expect(typeQueries.declarations).not.toContain(':USAGE');
    expect(typeQueries.implementations).not.toContain(':USAGE');
    expect(typeQueries.declarations).not.toContain('null AS');
    expect(typeQueries.implementations).not.toContain('null AS');

    const fieldQueries = buildDeclarationRelationQueries({
      name: 'status', kind: 'field', qualifiedOwner: 'demo.Worker',
    });
    expect(fieldQueries.selected).toContain("selected.qualified_name ENDS WITH '.demo.Worker.status'");
    expect(fieldQueries.declarations).toBeUndefined();
    expect(fieldQueries.implementations).toBeUndefined();
  });

  it('matches type implementations in the concrete-to-declaration direction', () => {
    const query = buildCandidateQuery({ name: 'Worker', implementations: true, kind: 'type' });
    expect(query).toContain('MATCH (decl) MATCH (s)-[r:IMPLEMENTS|INHERITS]->(decl)');
    expect(query).toContain("decl.name = 'Worker'");
  });

  it('returns only references with an explicit occurrence line', () => {
    const query = buildCandidateQuery({ name: 'run' });
    expect(query).toContain('MATCH (target:Method) MATCH (source)-[r:CALLS|CALL_REFERENCE|USAGE]->(target)');
    expect(query).toContain('r.line IS NOT NULL');
    expect(query).toContain('source.file_path AS file');
  });

  it('uses containing source ranges for type usages without occurrence lines', () => {
    const query = buildCandidateQuery({ name: 'ReportCategory', kind: 'type' });
    expect(query).toContain('MATCH (target) MATCH (source)-[r:USAGE]->(target)');
    expect(query).toContain("target.name = 'ReportCategory'");
    expect(query).toContain('source.start_line AS start_line');
    expect(query).toContain('source.end_line AS end_line');
    expect(query).not.toContain('target:Method');
    expect(query).not.toContain('r.line IS NOT NULL');
  });

  it('resolves a method invocation through its exact source file and call line', () => {
    const query = buildCandidateQuery({
      name: 'exportReport',
      kind: 'method',
      argumentCount: 2,
      definitions: true,
      sourceFile: 'app/src/ReportController.java',
      sourceLine: 42,
    });
    expect(query).toContain('MATCH (source)-[r:CALLS|CALL_REFERENCE]->(target)');
    expect(query).toContain("source.file_path = 'app/src/ReportController.java'");
    expect(query).toContain('r.line = 42');
    expect(query).toContain('target.param_count = 2');
    expect(query).toContain('owner.qualified_name AS receiver_type');
    expect(query).toContain('owner.label AS owner_kind');
  });

  it('can return type-relationship reference ranges', () => {
    const query = buildCandidateQuery({ name: 'Worker', typeReferences: true });
    expect(query).toContain('MATCH (target) MATCH (source)-[r:IMPLEMENTS|INHERITS]->(target)');
    expect(query).toContain('source.start_line AS start_line');
    expect(query).toContain('target.qualified_name AS qn');
  });
});
