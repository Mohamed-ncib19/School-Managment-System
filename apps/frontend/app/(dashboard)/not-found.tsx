import NotFoundContent from "@/components/shared/not-found-content";

/**
 * In-shell 404 for unknown routes inside the dashboard group: the sidebar and
 * navbar stay mounted, so a bad deep link (e.g. /financial/typo) still offers
 * navigation instead of dumping the user onto a bare page.
 */
export default function DashboardNotFound() {
  return (
    <div className="flex justify-center py-20">
      <NotFoundContent />
    </div>
  );
}
