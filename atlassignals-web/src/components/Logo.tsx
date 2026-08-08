/**
 * Logo.tsx — brand mark (logo PNG from the project root) + wordmark.
 */
import { APP_NAME } from '../lib/site';

export default function Logo({
  size = 34,
  showWord = true,
  img = '/logo-main.png',
}: {
  size?: number;
  showWord?: boolean;
  img?: string;
}) {
  return (
    <span className="brand">
      <img src={img} alt={`${APP_NAME} logo`} width={size} height={size} />
      {showWord && <span>{APP_NAME}</span>}
    </span>
  );
}
