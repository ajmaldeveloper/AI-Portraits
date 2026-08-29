export function StyleNameLink({ id, name }: { id: string; name: string }) {
  return <s-link href={`/app/styles/${id}`}>{name}</s-link>;
}
