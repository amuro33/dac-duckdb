/** A source keeps its own snapshot ID separately from its originating query/workflow. */
export function sourceIdentifier(source: { id: string; kind: string; origin?: { workflowId?: string; queryId?: string } }) {
  return (source.kind === "workflow" ? source.origin?.workflowId : source.origin?.queryId) || source.id;
}
export function Identity({ id, description }: { id: string; description?: string }) {
  return <span className="entity-identity"><strong className="entity-id">{id}</strong>{description && <small>{description}</small>}</span>;
}
