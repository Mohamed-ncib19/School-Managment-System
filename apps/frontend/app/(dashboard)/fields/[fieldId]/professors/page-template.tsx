export default function DisabledPage({ title }: { title: string }) {
  return (
    <div className="card py-12 text-center">
      <h2 className="text-h4 font-bold text-text-primary">{title}</h2>
      <p className="text-sm text-text-secondary mt-2">This page is being built in the next milestone.</p>
    </div>
  );
}
