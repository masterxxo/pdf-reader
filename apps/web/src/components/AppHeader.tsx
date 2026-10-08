import { APP_NAME } from '@pdf-insight/shared';

export function AppHeader() {
  return (
    <header className="app-header">
      <h1 className="app-title">{APP_NAME}</h1>
    </header>
  );
}
