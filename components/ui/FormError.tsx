export type FormErrorProps = {
  id?: string;
  message?: string;
};

// role="alert" so a screen reader announces the failure the moment it appears. Renders
// nothing when there is no message, rather than an empty box that shifts the layout.
export function FormError({ id, message }: FormErrorProps) {
  if (!message) return null;

  return (
    <p id={id} role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
