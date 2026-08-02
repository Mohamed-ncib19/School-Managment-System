import NotFoundContent from "@/components/shared/not-found-content";

/**
 * Root 404: anything that matches no route (e.g. /typo) lands here, outside
 * the dashboard shell. The gradient wrapper matches the auth screens so an
 * unknown address still feels like part of the product.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary via-primary-700 to-primary-900 p-4">
      <div className="w-full max-w-md rounded-modal bg-surface p-10 shadow-hover">
        <NotFoundContent />
      </div>
    </div>
  );
}
